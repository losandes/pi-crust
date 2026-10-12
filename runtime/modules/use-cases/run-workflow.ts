/**
 * One composed workflow, start to finish — the body every activity script shares.
 *
 * A workflow built from activities is its activity list and nothing else, so the list is
 * the only thing each script declares. Everything structural — validating the
 * roster before anything spawns, minting or resuming the session, pinning the
 * baseline, recording the ask, folding the activities, settling the run — happens
 * here, once.
 *
 * Hand-written workflows still exist, and should: a conditional tail is real
 * control flow that a list of names cannot express. Those keep their own `main`
 * and call `skipIfDone` per activityRun.
 *
 * One loop is no longer among them. A chain ending in `review` or `code-review`
 * gets the bounded revise loop here, so the generalisation is the activity
 * library's rather than one workflow's.
 */

import { runLink, visualizerIsUp } from '../data/visualizer'
import { isRepo, rev, shortSha } from '../data/git'
import type { TActivityContext, TActivityOptions } from '../typedefs/runnable-activity'
import type { TAttemptLedger } from './attempts'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import type { TGateReason } from './human-gate'
import {
  parseApproveAfter,
  resumeInvocation,
  writeDecisionRequest,
} from './human-gate'
import { attemptLedger } from './attempts'
import { loadConfigWithNotes } from './load-config'
import { readRunState } from './read-run-state'
import type { TWorkflowArgs } from './parse-cli'
import { loopAgents, runReviseLoop } from './revise-loop'
import { selfAnsweredIn } from './human-gate'
import { finish, finishWaiting } from './run-activity-run'
import type { TWaiting } from './run-activities'
import type { TStage } from '../typedefs/lifecycle'
import { plannedNames, unitsFrom } from './plan-units'
import { recordRequest, runActivities, runUnits } from './run-activities'
import { chainNote, plannedChain } from './operator-plan'
import {
  describeTrust,
  TRUST_PROVISIONAL,
  trustLevel,
} from '../typedefs/trust'
import { startSession } from './start-session'
import { requiredAgents, runnableActivities } from './activities'
import { validateAgents } from './validate-agents'

export const NOT_ACCEPTED =
  'a activity did not meet its own criterion — a check failed, or a review was ' +
  'not approved. The activityRuns all ran; the work is what did not pass.'

/**
 * What this session has already spent, by instance name.
 *
 * A budget that reset on resume would be no budget at all: a run that
 * exhausted an Activity could be restarted into the same wall forever.
 * Superseded rows are excluded, because they are the ones a person steered
 * — human-directed re-execution is not an attempt.
 */
const spentAlready = (
  cfg: TPiCrustConfig,
  runId: string | undefined,
): readonly string[] => {
  if (runId === undefined) {
    return []
  }
  const state = readRunState(cfg.observability.db, runId)

  return (state?.activityRuns ?? [])
    .filter(
      (activityRun) =>
        activityRun.kind === 'agent' && activityRun.status !== 'superseded',
    )
    .map((activityRun) => activityRun.name)
}

/**
 * HEAD before this run commits anything, for the documenter's diff.
 *
 * Only pinned when a activity needs it: a repository with no commit yet cannot
 * resolve HEAD, and a chain that never documents should not fail on that.
 */
const pinBaseline = (names: readonly string[]): string =>
  names.includes('document') && isRepo() ? rev('HEAD') : ''

/**
 * Run the chain an operator planned, inside the run that planned it.
 *
 * Returns `undefined` when a planned activity stopped for a person — the caller
 * settles the run as waiting, and a resume replays the operator activityRun from
 * the trace and picks the chain up where it stopped.
 */
const runPlannedChain = async (
  run: TRun,
  planned: readonly string[],
  options: Readonly<Partial<TActivityOptions>>,
  ctx: TActivityContext,
  args: TWorkflowArgs,
  trust: number,
  ledger: TAttemptLedger,
): Promise<TActivityContext | undefined> => {
  const activities = runnableActivities(planned, run.cfg, options)
  validateAgents(run.cfg, [
    ...new Set([...requiredAgents(activities), ...loopAgents(run.cfg, planned)]),
  ])
  run.console.note(chainNote(planned))

  /*
   * Below the provisional threshold, an agent does not get to spend your
   * budget on a chain you have not seen.
   *
   * This is the trust dial applied to the one decision the dial did not
   * previously reach: every other stage asks about what it could not
   * establish, and this one asks about what it intends to DO. It is checked
   * here rather than requested in the operator's prompt, because a prompt
   * can ask an agent to flag its plan and only code can guarantee it —
   * exactly the argument that put `steps_valid` in a gate.
   *
   * Exempt once replayed, for the reason the stage gate is: the person
   * already approved this chain, and that approval is why the run is running
   * again. Asking a second time is the approve-resume-replay-approve loop.
   */
  if (trust < TRUST_PROVISIONAL && !run.resume.has('operator')) {
    const reason: TGateReason = {
      kind: 'plan',
      activity: 'operator',
      activities: planned,
    }
    const path = writeDecisionRequest(
      run.contextHandoffDir,
      reason,
      run.runId,
      resumeInvocation(process.argv, run.runId),
    )
    run.console.note(
      `waiting for you: the operator chose a chain it has not run — ${path}`,
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: '',
      type: 'log',
      name: 'human_gate_open',
      payload: { activity: 'operator', kind: 'plan', request: path, activities: planned },
    })
    return undefined
  }

  let stopped: TWaiting | undefined
  const after = await runActivities({
    run,
    activities,
    start: ctx,
    approveAfter: parseApproveAfter(args.approveAfter),
    onWaiting: (waiting) => {
      stopped = waiting
    },
    trust,
    ledger,
  })
  return stopped === undefined ? after : undefined
}

export const runWorkflow = async (
  args: TWorkflowArgs,
  plan: readonly TStage[],
): Promise<number> => {
  const names = plannedNames(plan)
  const loaded = loadConfigWithNotes(args.config)
  const cfg = loaded.config
  const options: Readonly<Partial<TActivityOptions>> = {
    ...(args.base === undefined ? {} : { base: args.base }),
    committing: args.commit !== 'false',
  }
  const activities = runnableActivities(names, cfg, options)
  // The loop can spawn the reviser even when the named chain never does, so
  // its agent is validated here rather than discovered halfway through.
  validateAgents(cfg, [
    ...new Set([...requiredAgents(activities), ...loopAgents(cfg, names)]),
  ])
  /*
   * One budget for the whole run, seeded from what this session already
   * spent. A resume must not refill it — the work it is resuming is the
   * work that spent it — while the replays a resume performs cost nothing,
   * because they execute nothing.
   */
  const ledger = attemptLedger(spentAlready(cfg, args.runId))
  const trust = trustLevel(args.trustLevel)
  const run = startSession(cfg, args.runId, {
    resume: args.resume,
    stream: args.stream,
    trust,
  })
  /*
   * From here the session row says `running`, so every exit has to say
   * otherwise — including a throw.
   *
   * A run that dies after `startSession` and before `finish` leaves a
   * session claiming to be running with nothing running, and the interface
   * believes it indefinitely. Observed: a resume died in startup parsing
   * its own stored envelope, and the run read as live for the rest of the
   * day. The error is still rethrown; this only makes the trace agree with
   * reality before it leaves.
   */
  // biome-ignore lint/plugin: this layer owns the boundary and rethrows
  try {
    /*
     * Said on every run, including the default one.
     *
     * This used to be silent at the default because the default asked about
     * everything consequential — silence meant "nothing is being decided for
     * you". The default now answers reversible questions on its own, and a run
     * that quietly does that is a run whose report of self-answered decisions
     * arrives as a surprise at the end.
     */
    /*
     * Said out loud, because the file is gitignored and therefore invisible to
     * everyone except the person it belongs to. A run whose models or writes
     * boundaries differ from the committed roster, with nothing on screen
     * saying so, is a run whose trace cannot be compared with anyone else's.
     */
    if (loaded.localPath !== '') {
      run.console.note(`local config in force: ${loaded.localPath} (not in git)`)
    }
    for (const warning of loaded.warnings) {
      run.console.note(warning)
    }

    run.console.note(describeTrust(trust))
    /*
     * Where to watch it, when there is somewhere to watch. Probed rather than
     * assumed: a link to a port nothing is listening on teaches a reader to
     * ignore the next hint too.
     */
    const ports = cfg.observability.ports
    if (await visualizerIsUp(process.env, fetch, ports.backend)) {
      run.console.instructions([
        `watch: ${runLink(run.runId, process.env, ports.frontend)}`,
      ])
    }

    const baseline = pinBaseline(names)

    await recordRequest(
      run,
      args.prompt,
      baseline === ''
        ? { activities: names.join(' -> ') }
        : { activities: names.join(' -> '), baseline: shortSha(baseline) },
    )

    const start: TActivityContext = {
      run,
      prompt: args.prompt,
      previous: undefined,
      previousStep: undefined,
      upstream: [],
      cohort: [],
      baseline,
      outcomes: [],
      feedback: [],
    }
    // `let` is deliberate and contained: the callback fires inside the fold,
    // and threading an out-parameter through every activity for one optional
    // outcome would be worse than a single assignment nothing else can see.
    let waiting: TWaiting | undefined
    const ctx = await runUnits({
      run,
      units: unitsFrom(plan, activities),
      start,
      approveAfter: parseApproveAfter(args.approveAfter),
      onWaiting: (stopped) => {
        waiting = stopped
      },
      trust,
      ledger,
    })
    if (waiting !== undefined) {
      return finishWaiting(run, waiting.path)
    }

    /*
     * An operator chose the chain: run it, here, in this run.
     *
     * It continues the same session rather than starting another, because the
     * plan and the work it caused belong in one trace — a reader asking "why
     * these activities" must find the answer beside them, not in a sibling run.
     *
     * Agents are revalidated before anything spawns, exactly as they are for a
     * named chain. The whole point of validating up front is that a chain never
     * dies three stages in on a missing agent, and a chain chosen at runtime
     * would lose that guarantee if it were skipped here.
     */
    const planned = plannedChain(ctx)
    const executed = planned.length > 0 ? planned : names
    const after =
      planned.length === 0
        ? ctx
        : await runPlannedChain(run, planned, options, ctx, args, trust, ledger)
    if (after === undefined) {
      return finishWaiting(run, run.contextHandoffDir)
    }

    const settled = await runReviseLoop(run, {
      names: executed,
      options,
      ctx: after,
      fallbackReason: NOT_ACCEPTED,
      ledger,
    })

    /*
     * The bargain of a raised dial, collected in one place.
     *
     * Each self-answered question was already said as it happened, but a line
     * in the middle of a nine-stage run is a line nobody scrolls back to. This
     * is the part a reader is owed: here is what nobody reviewed, and here is
     * what the chain decided instead.
     */
    const decided = selfAnsweredIn(run, trust)
    if (decided.length > 0) {
      run.console.instructions([
        `${decided.length} question(s) this run answered for itself (trust ${trust}):`,
        '',
        ...decided.flatMap((entry) => [
          `  ${entry.activity}: ${entry.question}`,
          `      → ${entry.answer}`,
        ]),
      ])
    }

    return finish(run, { accepted: settled.accepted, reason: settled.reason })
  } catch (error) {
    run.tracer.sessionFinish(run.runId, false)
    run.tracer.processesEndAll(run.runId)
    throw error
  }
}
