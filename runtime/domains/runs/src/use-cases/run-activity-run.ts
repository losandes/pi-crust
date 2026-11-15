/**
 * The ONE activityRun primitive, and the one place a run is finalized.
 *
 * `runActivityRun(run)(params, async (ph) => { … })` covers all three kinds
 * (engineer, agent, code). Success must be earned: every activity run defaults to
 * fail; only a clean exit flips it (agent activityRuns additionally require a parsed
 * envelope and green gates, enforced inside executeAgent).
 */

import type {
  TActivityRun,
  TActivityRunHandle,
  TActivityRunParams,
  TRun,
} from '../../../../lib/contracts'
import { EXIT } from '../../../../lib/contracts'
import { monotonicMs, nowIso } from '../../../../lib/system'
import {
  changed,
  diffHandoff,
  isStepDocument,
  lockArtifacts,
  readAll,
  restoreAll,
  snapshotHandoff,
  unlockArtifacts,
} from '../../../handoff'
import { decisionOptions, resumeInvocation } from './human-gate'

const openActivityRun = (
  run: TRun,
  params: TActivityRunParams,
): TActivityRun => {
  const seq = run.nextSeq()
  const activityRun: TActivityRun = {
    activity_run_id: `${run.runId}_${String(seq).padStart(2, '0')}_${params.name}`,
    run_id: run.runId,
    seq,
    params,
    status: 'running',
    error: undefined,
    started_at: nowIso(),
    ended_at: undefined,
  }
  run.recordActivityRun(activityRun)
  run.tracer.activityRunUpsert(activityRun)
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'activity_run_start',
    name: params.name,
    payload: {
      kind: params.kind,
      owner: params.owner,
      description: params.description,
    },
  })
  run.console.activityRunStarted(activityRun)
  return activityRun
}

/**
 * The event name carrying what a activity was observed to write.
 *
 * Distinct from the activity's own name because the trace is read back by name,
 * and a activity emits log and activityRun events under that name too — asking for
 * "what did design write" has to mean exactly that.
 */
export const artifactsEventName = (activity: string): string =>
  `${activity} artifacts`

/** The documents earlier runs created under this recorded name. */
const createdBefore = (run: TRun, activity: string): readonly string[] =>
  run.tracer
    .eventsNamed(run.runId, artifactsEventName(activity))
    .flatMap((payload) =>
      Array.isArray(payload.created)
        ? payload.created.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    )

/**
 * The names this run's documents are recorded under.
 *
 * Its own name and, on an agent run, its owner. An agent run's owner is the
 * registry Activity it executes: `executeAgent` resolves the roster entry
 * from it. The two differ when the engine names the run itself. A writer sent
 * back by its reviewers runs as `revise` or `revise-<writer>`, while the
 * document it has to rewrite is recorded under `<writer> artifacts`. An
 * engineer run's owner is a person's name, so it is not consulted there.
 */
const recordedUnder = ({
  name,
  kind,
  owner,
}: Pick<TActivityRunParams, 'name' | 'kind' | 'owner'>): readonly string[] =>
  kind === 'agent' ? [...new Set([name, owner])] : [name]

const handleFor = (
  run: TRun,
  activityRun: TActivityRun,
): TActivityRunHandle => ({
  activityRun,
  log: (payload) => {
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: 'log',
      name: activityRun.params.name,
      payload,
    })
    run.console.note(
      Object.entries(payload)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(', '),
    )
    if (activityRun.params.kind === 'engineer' && 'input' in payload) {
      run.tracer.sessionRequest(run.runId, String(payload.input))
    }
  },
})

/**
 * Run one activityRun. Rethrows whatever the body threw, after recording the failure.
 *
 * The activityRun boundary is the one place in this system where a throw is
 * meaningful: it is what turns "something went wrong anywhere below" into a
 * recorded, failed activityRun and a finalized session.
 */
export const runActivityRun =
  (run: TRun) =>
  async <TResult>(
    params: TActivityRunParams,
    body: (handle: TActivityRunHandle) => TResult | Promise<TResult>,
  ): Promise<TResult> => {
    const activityRun = openActivityRun(run, params)
    const clock = monotonicMs()
    /*
     * What the handoff directory held before this activityRun touched it.
     *
     * Taken here rather than inside the agent call because a code activity writes
     * documents too, and because an activity run that FAILED may still have written
     * one — which is precisely the file a reader goes looking for.
     */
    const handoffBefore = snapshotHandoff(run.contextHandoffDir)
    /*
     * A activity running again may replace its OWN documents.
     *
     * That is the one overwrite that must be allowed — a retry, or a
     * rejection sending the activity back, legitimately produces a new design.
     * Everything another activity produced stays locked, so "may I write this?"
     * is answered by who wrote it, not by who is asking.
     */
    const own = new Set(
      recordedUnder(params).flatMap((name) => createdBefore(run, name)),
    )
    unlockArtifacts(run.contextHandoffDir, [...own])
    /*
     * Copies of what exists, so damage can be undone.
     *
     * Git is the usual way back and it is unavailable here: the session
     * directory is ignored, which is both why an agent may write in it and
     * why nothing would notice when it writes over somebody else's work.
     * These are markdown documents of a few kilobytes.
     */
    const originals = readAll(run.contextHandoffDir, [...handoffBefore.keys()])
    const recordArtifacts = (): void => {
      const change = diffHandoff(
        handoffBefore,
        snapshotHandoff(run.contextHandoffDir),
      )
      if (!changed(change)) return
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: activityRun.activity_run_id,
        type: 'artifacts',
        name: artifactsEventName(params.name),
        payload: { ...change, observed: true },
      })
      /*
       * Lock on the way out, including when the activityRun failed: a failed activity
       * can still have written the document a reader wants, and the activity
       * after it has no more right to overwrite that one than any other.
       */
      /*
       * A activity's own documents, locked again: the ones it has just made, and
       * the ones it replaced because it had made them in an earlier attempt.
       */
      lockArtifacts(run.contextHandoffDir, [
        ...change.created,
        ...change.modified.filter((path) => own.has(path)),
      ])

      /*
       * Put back what this activity took from another.
       *
       * The lock stops an overwrite at the moment it is attempted, but it
       * cannot stop a DELETE — unlinking is governed by the directory's
       * permission, not the file's — and an agent that changed the mode back
       * is not prevented either. So the two are repaired rather than merely
       * reported: a run whose design silently became somebody else's design
       * is worse than a run that says what it put back.
       */
      /*
       * Damage is what this activity did to ANOTHER activity's documents.
       *
       * Its own are excluded, and that distinction is the whole reason the
       * trace records who created what: a retried activity rewriting its own
       * design is the ordinary path, and restoring the first attempt over it
       * would quietly undo the work the retry existed to do — which is what
       * this did until a test ran the same activity twice.
       */
      const damaged = [...change.modified, ...change.deleted].filter(
        (path) => isStepDocument(path) && !own.has(path),
      )
      if (damaged.length === 0) return
      const restored = restoreAll(run.contextHandoffDir, originals, damaged)
      lockArtifacts(run.contextHandoffDir, restored)
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: activityRun.activity_run_id,
        type: 'artifacts',
        name: `${params.name} restored`,
        payload: {
          restored,
          reason: 'a document belonging to an earlier activity was changed',
        },
      })
      run.console.note(
        `${params.name} changed ${damaged.length} document(s) belonging to ` +
          `earlier activities; restored ${restored.length}: ${restored.join(', ')}`,
      )
    }
    // This function IS the error boundary: turning a throw into a recorded
    // activityRun failure and a finalized session is its whole job, and the error is
    // rethrown rather than swallowed.
    // biome-ignore lint/plugin: this layer owns the error boundary and rethrows
    try {
      const result = await body(handleFor(run, activityRun))
      recordArtifacts()
      const ended = run.updateActivityRun(activityRun.activity_run_id, {
        status: 'success',
        ended_at: nowIso(),
      })
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: activityRun.activity_run_id,
        type: 'activity_run_end',
        name: params.name,
        payload: { status: 'success' },
      })
      run.tracer.activityRunUpsert(ended)
      run.console.activityRunEnded(ended, (monotonicMs() - clock) / 1000)
      return result
    } catch (error) {
      recordArtifacts()
      // success must be earned
      const failed = run.updateActivityRun(activityRun.activity_run_id, {
        status: 'fail',
        error: String(error instanceof Error ? error.message : error).slice(
          0,
          1000,
        ),
        ended_at: nowIso(),
      })
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: activityRun.activity_run_id,
        type: 'error',
        name: params.name,
        payload: { error: failed.error },
      })
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: activityRun.activity_run_id,
        type: 'activity_run_end',
        name: params.name,
        payload: { status: 'fail' },
      })
      run.tracer.activityRunUpsert(failed)
      run.tracer.sessionFinish(run.runId, false)
      run.console.activityRunEnded(failed, (monotonicMs() - clock) / 1000)
      run.console.sessionFinished(
        false,
        run.tokens(),
        run.cost(),
        run.cfg.observability.db,
      )
      throw error
    }
  }

/**
 * Does this activity run count towards the run's verdict?
 *
 * A superseded row is an attempt that a later attempt replaced — a gate
 * retry, or a steer. It stays in the trace because what it decided is worth
 * reading; it stops counting because the Activity it belongs to was run
 * again, and the later row is the answer.
 */
export const counts = (activityRun: Readonly<{ status: string }>): boolean =>
  activityRun.status !== 'superseded'

export type TFinishParams = Readonly<{
  accepted?: boolean
  reason?: string
}>

/**
 * Finalize the run and return its exit code. Call this exactly once.
 *
 * Two criteria, not one. Every activityRun must have passed, AND the workflow's own
 * acceptance test must hold. They are different questions on purpose: a test
 * activityRun that ran the suite did its job even when the suite came back red, so
 * the ACTIVITY RUN succeeds while the RUN must not. One call settles the db, the
 * banner, and the exit code together, so the three cannot disagree.
 */
/**
 * Settle a run that stopped for a person.
 *
 * Not `finish`, because `finish` decides between accepted and not, and this
 * run has not reached that question. The session is marked `waiting`, the exit
 * code is its own, and nothing is called a failure that is not one.
 */
export const finishWaiting = (run: TRun, requestPath: string): number => {
  run.tracer.sessionWaiting(run.runId)
  /*
   * Everything a person needs, in the terminal they are already looking at.
   *
   * The decision request on disk said all of this, but a developer watching a
   * run does not know that file exists until they open it, and "or reject /
   * answer" told them a verb without telling them what it costs or how to
   * continue afterwards. The resume line matters most: it carries the flags
   * this run was launched with, which are not stored anywhere.
   */
  const resume = resumeInvocation(process.argv, run.runId)
  const kind = run.tracer.eventsNamed(run.runId, 'human_gate_open').at(-1)?.kind
  run.console.instructions([
    `run ${run.runId} is waiting for you — ${requestPath}`,
    '',
    ...(kind === 'delivery'
      ? [
          'No answer is needed. Resolve what the error names, then resume:',
          `    ${resume}`,
        ]
      : decisionOptions(run.runId, resume)),
  ])
  return EXIT.WAITING
}

export const finish = (run: TRun, params: TFinishParams = {}): number => {
  const accepted = params.accepted ?? true
  /*
   * The run's recorded activity runs, read through the tracer rather than
   * the in-memory list this process accumulated (1.2.1): a resumed process
   * judges the whole run, not just the leg it ran itself.
   */
  const judged = run.tracer.activityRunsFor(run.runId).filter(counts)
  const activityRunsOk =
    judged.length > 0 &&
    judged.every((activityRun) => activityRun.status === 'success')
  const ok = activityRunsOk && accepted
  if (!activityRunsOk) {
    const failing = judged.filter(
      (activityRun) => activityRun.status !== 'success',
    )
    const note =
      judged.length === 0
        ? 'no activity run counted towards the verdict — every attempt was superseded'
        : `activity run(s) failed: ${failing
            .map(
              (activityRun) =>
                `${activityRun.activity_run_id} (${activityRun.status})`,
            )
            .join(', ')}`
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: judged.at(-1)?.activity_run_id ?? '',
      type: 'error',
      name: 'activity_runs_failed',
      payload: {
        reason: note,
        activityRuns: failing.map((activityRun) => ({
          activity_run_id: activityRun.activity_run_id,
          status: activityRun.status,
        })),
      },
    })
    run.console.note(note)
  }
  /*
   * Independent of activityRunsOk (1.3.3): a run can be both unaccepted and
   * hold a failed activity run, and a reader must not have to fix the first
   * reason before discovering the second.
   */
  if (!accepted) {
    const note = params.reason || "the run's acceptance criterion was not met"
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: judged.at(-1)?.activity_run_id ?? '',
      type: 'error',
      name: 'not_accepted',
      payload: { reason: note },
    })
    run.console.note(`not accepted: ${note}`)
  }
  run.tracer.sessionFinish(run.runId, ok)
  run.console.sessionFinished(
    ok,
    run.tokens(),
    run.cost(),
    run.cfg.observability.db,
  )
  return ok ? EXIT.SUCCESS : EXIT.FAILED
}
