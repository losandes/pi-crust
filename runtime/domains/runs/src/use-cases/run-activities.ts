/**
 * The driver: fold a context through an ordered list of Work Units.
 *
 * A Unit is one Activity, or a whole concurrent Stage. The fold does not
 * branch on which: it runs the Unit's activities, composes whatever they produced
 * into the context, and then gates. Everything that distinguishes serial from
 * concurrent was decided when the Units were built.
 *
 * Every activity goes through `skipIfDone`, so `--resume` works on every workflow
 * built this way without any workflow knowing resume exists.
 *
 * It does NOT call `finish`. The workflow does, because a workflow may have an
 * acceptance criterion of its own on top of the activities' — and `finish` must be
 * called exactly once, by whoever owns the run.
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../../../../../lib/typedefs/src/settlement'
import type {
  TActivity,
  TActivityContext,
  TActivityRun,
  TActivityRunStatus,
  TEnvelopeBase,
  TRun,
  TUnit,
  TUpstream,
} from '../../../../lib/contracts'
import {
  activityGates,
  activityRunParams,
  activitySuccession,
  regressionOf,
  TRUST_DEFAULT,
  violationsOf,
  WARNING_EVENT,
  wantsStageGate,
  warningPayload,
} from '../../../../lib/contracts'
import type { TRegressionRecord } from '../../../gates'
import { regressionNote, regressionVerdict } from '../../../gates'
import { observationsIn, touchedBy, unexpectedWarnings } from '../../../policy'
import type { TAttemptLedger } from './attempts'
import {
  attemptLedger,
  FIRST_ATTEMPT,
  gateCause,
  regressionCause,
} from './attempts'
import { commitActivity } from './deliver'
import type { TGateReason } from './human-gate'
import {
  answerAsFact,
  blockingQuestions,
  gateReason,
  resumeInvocation,
  selfAnswered,
  withDecisionAnswer,
  writeDecisionRequest,
} from './human-gate'
import { isReplayedActivityRunId, skipIfDone } from './resume'

/**
 * Record a status change, and persist it unless the row is a replay.
 *
 * A replayed row exists only in memory: it has no seq, no timestamps, and
 * the trace already holds the real row it stands for. Inserting it writes a
 * second row for one Activity — which is what put a phantom `build` in the
 * visualizer's queued lane (no `started_at`) while the run appeared to do
 * nothing — and corrupts the completed set the next resume reads.
 */
const settleStatus = (
  run: TRun,
  activityRunId: string,
  status: TActivityRunStatus,
): void => {
  const updated = run.updateActivityRun(activityRunId, { status })
  if (!isReplayedActivityRunId(run.runId, activityRunId)) {
    run.tracer.activityRunUpsert(updated)
  }
}

/** The activityRun row a gate event should hang off, best effort. */
const activityRunFor = (
  run: TRun,
  stepName: string,
): TActivityRun | undefined =>
  run
    .activityRuns()
    .findLast((activityRun) => activityRun.params.name === stepName)

const handleIdOf = (run: TRun, stepName: string): string =>
  activityRunFor(run, stepName)?.activity_run_id ?? ''

/**
 * The engineer activityRun every chain opens with: the ask, on the record.
 *
 * Skippable like any other activityRun, so a resumed run does not re-record a request
 * it already has.
 */
export const recordRequest = (
  run: TRun,
  prompt: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> =>
  skipIfDone(
    run,
    activityRunParams({
      name: 'request',
      kind: 'engineer',
      owner: run.engineer,
      description: 'Capture the incoming ask',
    }),
    (handle) => {
      handle.log({ input: prompt, ...extra })
    },
    () => Promise.resolve(undefined),
  )

/** A run that stopped for a person, and what it is waiting on. */
export type TWaiting = Readonly<{ reason: TGateReason; path: string }>

/** One Activity's result, named, so a composed context keeps its provenance. */
type TRan = Readonly<{
  activity: TActivity
  result: Awaited<ReturnType<TActivity['execute']>>
}>

/**
 * Run every Activity in a Unit, concurrently when the Stage claimed it.
 *
 * `allSettled`, not `all`. Siblings are already running by the time one of
 * them fails, and they cannot be recalled — an agent killed mid-write leaves
 * the tree in a state nobody declared. `all` would reject on the first
 * failure and throw away the results of Activities that had already
 * finished, which is both a lie about what happened and a loss of work the
 * run paid for.
 *
 * So everything is allowed to settle, what succeeded is kept, and the
 * failures are re-raised together with the count of what survived. A run
 * still dies on a failed Activity, exactly as it does serially; the
 * difference is that the trace says which of the Stage completed first.
 */
/**
 * One Activity Run, and the attempt it spends.
 *
 * The attempt is spent inside the body, so a replay spends nothing: a resume
 * past an answered gate is a person's decision, not the run deciding to try
 * again. `cause` is what the exhaustion report will say the budget went on —
 * one number explains nothing when a developer is asked why a chain stopped.
 */
const runStep = (
  run: TRun,
  unit: TUnit,
  ctx: TActivityContext,
  activity: TActivity,
  ledger: TAttemptLedger,
  params: Readonly<{ cause: string; feedback: readonly string[] }>,
): Promise<TRan> => {
  /*
   * Each Activity is told who else is running, and never itself. Permission
   * enforcement uses it to attribute a write by the path it landed on rather
   * than by the window it landed in.
   */
  const given: TActivityContext = {
    ...withDecisionAnswer(answerAsFact(run.contextHandoffDir, run.engineer))(
      ctx,
    ),
    cohort:
      unit.strategy === 'concurrent'
        ? unit.activities
            .filter((other) => other.name !== activity.name)
            .map((other) => other.name)
        : [],
    feedback: params.feedback,
  }

  return skipIfDone(
    run,
    activity.params,
    (handle) => {
      ledger.spend(activity.instance, params.cause)

      return activity.execute(given, handle)
    },
    () => activity.replay(given),
  ).then((result) => ({ activity, result }))
}

const runUnit = async (
  run: TRun,
  unit: TUnit,
  ctx: TActivityContext,
  params: Readonly<{ ledger: TAttemptLedger; cause: string }>,
): Promise<readonly TRan[]> => {
  const one = (activity: TActivity): Promise<TRan> =>
    runStep(run, unit, ctx, activity, params.ledger, {
      cause: params.cause,
      feedback: ctx.feedback,
    })

  if (unit.strategy !== 'concurrent') {
    return await unit.activities.reduce<Promise<readonly TRan[]>>(
      async (sofar, activity) => [...(await sofar), await one(activity)],
      Promise.resolve([]),
    )
  }

  const settled = await Promise.allSettled(unit.activities.map(one))
  const failures = settled.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  )
  const done = settled.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  )
  if (failures.length > 0) {
    throw new Error(
      `stage '${unit.stage}' lost ${failures.length} of ${unit.activities.length} ` +
        `activities; ${done.length} completed first and are in the trace:\n` +
        failures.map((reason) => `  - ${errorMessage(reason)}`).join('\n'),
    )
  }

  return done
}

/**
 * Judge one Activity's gates, recording every one of them.
 *
 * At the UNIT boundary, which in a concurrent Stage is the Stage boundary.
 * That is not a nicety: `checks` runs the repository's own commands against
 * the working tree, and a sibling Activity may still be writing to it.
 *
 * `gate.check`'s third argument is what this Activity Run was OBSERVED to
 * change — `touchedBy`, the same `enforcePermissions`/`snapshotTree`
 * before-and-after diff `paths_touched` already traces, aggregated across
 * every attempt this instance spent. It is never the envelope's own claim:
 * feeding a gate its claim back as the "observation" it is supposed to
 * check the claim against makes every claim unconditionally true, which is
 * the exact failure `diff_matches_claims` exists to catch.
 */
export const judgeGates = (
  run: TRun,
  activity: TActivity,
  envelope: TEnvelopeBase,
): readonly string[] => {
  const activityRun = activityRunFor(run, activity.instance)
  if (activityRun === undefined) {
    return []
  }

  return activity.gates.flatMap((gate) => {
    const report = gate.check(envelope, run, touchedBy(run, activity.instance))
    const found = violationsOf(report)
    run.tracer.gateRow(activityRun, gate.name, report)
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: found.length > 0 ? 'gate_fail' : 'gate_pass',
      name: gate.name,
      payload: { violations: found, checks: report.checks },
    })
    run.console.gateResult(gate.name, report)

    return found
  })
}

/**
 * Gate every Activity the Unit ran, re-running what did not hold.
 *
 * A failing gate feeds its violations back to the Activity it gates, which
 * runs AGAIN — a new Activity Run, with its own row, spending one of the
 * instance's attempts. It used to be a counter on the existing row, which
 * is why a budget counting Activity Runs would have missed gate failures
 * entirely: the case it most obviously governs.
 *
 * An Activity whose gates hold and which declares `commit: true` commits its
 * own change here, in the words its envelope carried.
 */
const settleGates = (
  params: Readonly<{
    run: TRun
    unit: TUnit
    ctx: TActivityContext
    ran: readonly TRan[]
    ledger: TAttemptLedger
    trust: number
    hasSuccessor: boolean
  }>,
): Promise<readonly TRan[]> => {
  const { run, unit, ctx, ran, ledger, trust, hasSuccessor } = params
  const settleOne = async (entry: TRan): Promise<TRan> => {
    const envelope = entry.result.previous
    const waiting = gateReason({
      activity: entry.activity.name,
      envelope,
      approveAfter: [],
      hasSuccessor,
      trust,
    })
    if (
      envelope === undefined ||
      entry.activity.gates.length === 0 ||
      waiting?.kind === 'escalated'
    ) {
      return entry
    }
    const violations = judgeGates(run, entry.activity, envelope)
    if (violations.length === 0) {
      if (entry.activity.commit) {
        /*
         * Settled, not called. `commitActivity` already contains the commit
         * git refused; this contains everything AROUND it — the
         * observed-paths lookup and the two trace writes, either of which
         * can throw on a locked database. A commit is the last thing that
         * should be able to end a chain whose gates have just passed, and
         * "whatever failed in there" is the only rule that stays true as
         * the inside of it changes.
         */
        const committed = safeParseSettlement(() =>
          commitActivity(
            run,
            entry.activity.instance,
            handleIdOf(run, entry.activity.instance),
            envelope,
            unit.stage,
          ),
        )
        if (committed.status === 'error') {
          run.console.note(
            `${entry.activity.instance}: commit step failed — ` +
              `${errorMessage(committed.error).split('\n')[0] ?? ''} ` +
              '(the work is in the tree; nothing was staged back)',
          )
        }
      }

      return entry
    }
    const standing = activityRunFor(run, entry.activity.instance)
    if (
      ledger.remaining(entry.activity.instance, entry.activity.attempts) === 0
    ) {
      // The row said success because the Activity ran; its work is what did
      // not hold, and a trace that leaves it green is a trace that disagrees
      // with the reason the run stopped.
      if (standing !== undefined) {
        settleStatus(run, standing.activity_run_id, 'fail')
      }
      throw new Error(
        `${entry.activity.instance} failed its gates and has no attempts left:\n- ` +
          `${violations.join('\n- ')}\n\n` +
          ledger.report(entry.activity.instance, entry.activity.attempts),
      )
    }
    if (standing !== undefined) {
      settleStatus(run, standing.activity_run_id, 'superseded')
    }
    run.console.note(
      `${entry.activity.instance}: ${violations.length} gate violation(s) — ` +
        'running it again ' +
        `(attempt ${ledger.spent(entry.activity.instance) + 1} of ${entry.activity.attempts})`,
    )

    return settleOne(
      await runStep(run, unit, ctx, entry.activity, ledger, {
        cause: gateCause(violations),
        feedback: violations,
      }),
    )
  }

  return ran.reduce<Promise<readonly TRan[]>>(
    async (sofar, entry) => [...(await sofar), await settleOne(entry)],
    Promise.resolve([]),
  )
}

/**
 * Say what the run is not going to do, and why, before it stops.
 *
 * A run that halts leaves every Activity after it with no record at all,
 * which on the trace is indistinguishable from a Lifecycle that never had
 * those Activities. The difference is the whole question a reader has:
 * `blocked` says the work is still owed and a person is holding it,
 * `cancelled` says it is not coming.
 *
 * Recorded as an event rather than as activityRun rows, because an activity run row claims
 * something was started and these were not.
 */
const recordUnreached = (
  run: TRun,
  remaining: readonly TUnit[],
  status: 'blocked' | 'cancelled',
  because: string,
): void => {
  const names = remaining.flatMap((unit) =>
    unit.activities.map((activity) => activity.name),
  )
  if (names.length === 0) {
    return
  }
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: '',
    type: 'log',
    name: `activities_${status}`,
    payload: { activities: names, status, because },
  })
}

/**
 * Say what changed during this Unit that nobody accounted for.
 *
 * At the Unit boundary rather than inside the agent call, for two reasons: a
 * concurrent Stage must raise ONE warning rather than one per sibling saying
 * the same thing about the same path, and only the driver knows the Stage.
 *
 * It is a warning and not a gate. A gate stops the run and asks, which is
 * right for a question only a person can answer about the work and wrong
 * here: the overwhelmingly common cause is a developer typing in their own
 * repository, which is a supported way to work rather than an incident. A run
 * that halted every time somebody saved a file would be unusable in the tree
 * they are actually in.
 *
 * So it spends no attempt, opens no gate, and fails nothing. It is recorded,
 * and the surfaces that report a run read it back at the end.
 */
const noteUnexpectedChanges = (
  run: TRun,
  unit: TUnit,
  ran: readonly TRan[],
): void => {
  const instances = new Set(ran.map((one) => one.activity.instance))
  const warnings = unexpectedWarnings({
    stage: unit.stage,
    concurrent: unit.strategy === 'concurrent',
    observations: observationsIn(run).filter((observed) =>
      instances.has(observed.activity),
    ),
  })
  for (const warning of warnings) {
    run.console.note(
      `${warning.paths.length} unexpected change(s) during ` +
        `'${warning.stage}' — pi-crust cannot tell whose they are, and ` +
        'changed nothing back',
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: warning.activityRunIds[0] ?? '',
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload(warning),
    })
  }
}

/**
 * Report upstream Activities that disagree, rather than quietly picking one.
 *
 * Two Activities in one Stage can accept and reject the same work — that is
 * the normal case for a reviewer and a code-reviewer, and it is the whole
 * reason for running both. Merging them into a single verdict would discard
 * the disagreement, which is the finding. The composed context carries both
 * and the disagreement is said out loud.
 */
const noteDisagreement = (
  run: TRun,
  unit: TUnit,
  ran: readonly TRan[],
): void => {
  const accepted = ran.filter((one) => one.result.accepted)
  if (
    ran.length < 2 ||
    accepted.length === 0 ||
    accepted.length === ran.length
  ) {
    return
  }
  const split = ran
    .map(
      (one) =>
        `${one.activity.name} ${one.result.accepted ? 'accepted' : 'rejected'}`,
    )
    .join(', ')
  run.console.note(`'${unit.stage}' disagreed with itself: ${split}`)
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: '',
    type: 'log',
    name: 'stage_disagreement',
    payload: { stage: unit.stage, outcomes: split },
  })
}

/**
 * Everything the driver needs, as one object.
 *
 * It was six positional parameters and had earned the four-param rule twice
 * over; the ledger would have been the seventh. The ledger is explicit
 * rather than minted here because the revise loop spends from the SAME
 * budget — one ceiling means one ledger for the whole run.
 */
export type TRunUnitsParams = Readonly<{
  run: TRun
  units: readonly TUnit[]
  start: TActivityContext
  approveAfter?: readonly string[]
  onWaiting?: (waiting: TWaiting) => void
  /** Work following this nested fold, such as the reviser's reviewers. */
  hasSuccessor?: boolean
  trust?: number
  ledger?: TAttemptLedger
  /** why this execution runs; gate retries supply their own cause */
  cause?: string
  /** settle a segment before the next Unit, without losing regression history */
  afterUnit?: (
    ctx: TActivityContext,
    at: number,
  ) => Promise<
    Readonly<{
      ctx: TActivityContext
      stopReason?: string
      /** how the Units after a stop are recorded; a waiting stop is `blocked` */
      stopStatus?: 'blocked' | 'cancelled'
    }>
  >
}>

export const runUnits = (
  params: TRunUnitsParams,
): Promise<TActivityContext> => {
  const { run, units, start } = params
  const carriedInitially = new Set(start.upstream.map((one) => one.activity))
  const approveAfter = params.approveAfter ?? []
  const onWaiting = params.onWaiting ?? (() => undefined)
  const trust = params.trust ?? run.trust ?? TRUST_DEFAULT
  const ledger = params.ledger ?? attemptLedger()
  const names = units.flatMap((unit) =>
    unit.activities.map((activity) => activity.name),
  )
  const gatedActivities = activityGates(approveAfter)

  /** Where in `names` a Unit's first Activity sits, for the regression rules. */
  const startOf = (index: number): number =>
    units
      .slice(0, index)
      .reduce((sofar, unit) => sofar + unit.activities.length, 0)

  /** The Unit that holds a named Activity, for a regression's destination. */
  const unitHolding = (name: string): number =>
    units.findIndex((unit) =>
      unit.activities.some((activity) => activity.name === name),
    )

  const fold = async (
    ctx: TActivityContext,
    index: number,
    history: readonly TRegressionRecord[],
  ): Promise<TActivityContext> => {
    const unit = units[index]
    if (unit === undefined) {
      return ctx
    }
    const hasSuccessor =
      index + 1 < units.length || params.hasSuccessor === true
    const ran = await settleGates({
      run,
      unit,
      ctx,
      ran: await runUnit(run, unit, ctx, {
        ledger,
        cause: params.cause ?? FIRST_ATTEMPT,
      }),
      ledger,
      trust,
      hasSuccessor,
    })
    noteDisagreement(run, unit, ran)
    noteUnexpectedChanges(run, unit, ran)

    const produced: readonly TUpstream[] = ran.flatMap((one) =>
      one.result.previous === undefined
        ? []
        : [{ activity: one.activity.name, envelope: one.result.previous }],
    )
    // Map replacement retains first-production order while bounding the
    // history to the latest envelope per participant, not per attempt.
    const upstream = [
      ...new Map(
        [...ctx.upstream, ...produced].map((one) => [one.activity, one]),
      ).values(),
    ]
    // The first superseding result wins within a Unit, regardless of which
    // concurrent sibling finished first. Annotations never replace the work.
    const superseding = ran.find((one) => {
      const name =
        one.activity.params.kind === 'agent'
          ? one.activity.params.owner
          : one.activity.name
      // Rehydrating an already-carried result is not new work. In particular,
      // replaying the original builder must not displace a later revision.
      const replayed =
        carriedInitially.has(one.activity.name) &&
        isReplayedActivityRunId(
          run.runId,
          handleIdOf(run, one.activity.instance),
        )

      return (
        one.result.previous !== undefined &&
        activitySuccession(run.cfg.activities, name) === 'supersedes' &&
        !replayed
      )
    })
    const primary = ran[0]
    const last = ran.at(-1)
    const next: TActivityContext = {
      ...ctx,
      previous: superseding?.result.previous ?? ctx.previous,
      previousStep:
        superseding === undefined
          ? ctx.previousStep
          : superseding.activity.name,
      upstream,
      cohort: [],
      outcomes: [
        ...ctx.outcomes,
        ...ran.map((one) => ({
          activity: one.activity.name,
          accepted: one.result.accepted,
        })),
      ],
    }

    const activity = (unit.strategy === 'concurrent' ? primary : last)?.activity
    if (activity === undefined) {
      return fold(next, index + 1, history)
    }
    const result = (unit.strategy === 'concurrent' ? primary : last)?.result

    // Stop for a person BEFORE deciding anything about regression: a stage
    // that left a consequential question has handed the decision to a human,
    // and the chain must not reason its way past it in the meantime.
    /*
     * A stage that was already successful before this process started has
     * already been gated, and the person already answered — that answer is
     * why the run is running again. Asking a second time is an approve loop:
     * approve, resume, replay, gate, approve, forever. Observed exactly that
     * way on the first live test of resuming from a gate.
     */
    /*
     * A stage gate is spelled `stage:<name>` and only fires on the Unit that
     * ends the Stage. In a serial Stage that is its last Activity, so
     * `--approve-after stage:design` stops after the Stage rather than after
     * the first thing in it; in a concurrent Stage there is only one Unit,
     * which is the same place.
     */
    const stageGated =
      unit.endsStage && wantsStageGate(approveAfter, unit.stage)
    const gates = ran.flatMap((one) => {
      const replayed = isReplayedActivityRunId(
        run.runId,
        handleIdOf(run, one.activity.instance),
      )
      if (replayed) return []
      const reason = gateReason({
        activity: one.activity.name,
        envelope: one.result.previous,
        approveAfter: stageGated
          ? [...gatedActivities, one.activity.name]
          : gatedActivities,
        hasSuccessor,
        trust,
      })

      return reason === undefined ? [] : [reason]
    })
    /*
     * The first in declaration order, when a concurrent Stage raised several.
     * They are all recorded in the Unit's outcomes; the run can only wait on
     * one thing, and waiting on the earliest is the one choice that does not
     * depend on which agent happened to finish first.
     */
    const gate = gates[0]
    if (gate !== undefined) {
      for (const one of ran) {
        if (
          gates.some(
            (reason) =>
              reason.kind === 'escalated' &&
              reason.activity === one.activity.name,
          )
        ) {
          settleStatus(run, handleIdOf(run, one.activity.instance), 'waiting')
        }
      }
      const path = writeDecisionRequest(
        run.contextHandoffDir,
        gate,
        run.runId,
        resumeInvocation(process.argv, run.runId),
      )
      run.console.note(
        gate.kind === 'escalated'
          ? `waiting for you: '${gate.activity}' escalated ${gate.questions.length} ` +
              `question(s) it may not settle at this trust level — ${path}`
          : `waiting for you: approval requested after '${gate.activity}' — ${path}`,
      )
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: handleIdOf(
          run,
          ran.find((one) => one.activity.name === gate.activity)?.activity
            .instance ?? gate.activity,
        ),
        type: 'log',
        name: 'human_gate_open',
        payload: {
          stage: gate.activity,
          unit: unit.stage,
          kind: gate.kind,
          request: path,
        },
      })
      recordUnreached(
        run,
        units.slice(index + 1),
        'blocked',
        `waiting for a person after '${gate.activity}'`,
      )
      onWaiting({ reason: gate, path })
      return next
    }

    /*
     * The last stage's consequential questions are no longer a gate, but they
     * are still the most important thing the run produced. Said once, on the
     * console and in the trace, so a reader who only sees the tail sees them.
     */
    /*
     * Anything this stage decided for itself because the dial allowed it.
     * Said as it happens AND collected for the end: a decision nobody
     * reviewed must not be discoverable only by reading an envelope.
     */
    for (const one of ran) {
      for (const decided of selfAnswered(one.result.previous, trust)) {
        run.console.note(
          `'${one.activity.name}' answered its own question: ${decided.question} → ${decided.answer}`,
        )
        run.tracer.event({
          run_id: run.runId,
          activity_run_id: handleIdOf(run, one.activity.name),
          type: 'log',
          name: 'self_answered',
          payload: { activity: one.activity.name, ...decided, trust },
        })
      }
    }

    const trailing = hasSuccessor
      ? []
      : blockingQuestions(result?.previous, trust)
    if (trailing.length > 0) {
      run.console.note(
        `'${activity.name}' finished the chain with ${trailing.length} open ` +
          'question(s) — nothing is blocked, but they are yours to answer:',
      )
      for (const question of trailing) {
        run.console.note(`  - ${question}`)
      }
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: handleIdOf(run, activity.name),
        type: 'log',
        name: 'open_questions',
        payload: { activity: activity.name, questions: trailing },
      })
    }

    /*
     * A regression spends from the destination's own budget, like every
     * other autonomous re-execution. It was a separate cap of one per
     * stage, which let a bad input burn a gate retry, a revision AND a lap
     * of the chain before anybody was asked.
     */
    const destination = units
      .flatMap((one) => one.activities)
      .find(
        (activity) =>
          activity.name === regressionOf(result?.previous)?.activity,
      )
    const verdict = regressionVerdict({
      request: regressionOf(result?.previous),
      names,
      askedAt: startOf(index),
      history,
      attemptsLeft:
        destination === undefined
          ? 0
          : ledger.remaining(destination.instance, destination.attempts),
    })

    if (verdict.kind === 'refused' || verdict.kind === 'exhausted') {
      // Not a throw: the stage did its job and said something true. The run
      // is what cannot continue, and `finish` settles that with the reason.
      recordUnreached(
        run,
        units.slice(index + 1),
        'cancelled',
        `regression ${verdict.kind}: ${verdict.reason}`,
      )
      run.console.note(`regression ${verdict.kind}: ${verdict.reason}`)
      run.tracer.event({
        run_id: run.runId,
        type: 'log',
        name: `regression_${verdict.kind}`,
        payload: { from: activity.name, reason: verdict.reason },
      })
      return {
        ...next,
        outcomes: [
          ...next.outcomes,
          { activity: activity.name, accepted: false },
        ],
      }
    }

    if (verdict.kind === 'regress') {
      const record: TRegressionRecord = {
        from: activity.name,
        to: verdict.to,
        because: regressionOf(result?.previous)?.because ?? '',
      }
      run.console.note(regressionNote(record))
      run.tracer.event({
        run_id: run.runId,
        type: 'log',
        name: 'regression',
        payload: { ...record },
      })
      /*
       * The lap is charged to the Activity being returned to, before it
       * runs: it is about to execute again because the run decided so, and
       * `skipIfDone` would otherwise charge it as a first attempt.
       */
      if (destination !== undefined) {
        ledger.spend(
          destination.instance,
          regressionCause(activity.name, record.because),
        )
      }
      // Re-running a stage means its earlier success no longer settles the
      // run: the chain from here is being redone, and the record of what the
      // abandoned path decided stays in the trace rather than in the verdict.
      /*
       * Back to the Unit that holds the destination Activity, not to the
       * destination's own index — those are different numbers now that a
       * Unit can hold several Activities, and the flat one would re-enter
       * the list in the wrong place.
       */
      return fold(next, unitHolding(verdict.to), [...history, record])
    }

    const boundary = await params.afterUnit?.(next, index)
    const after = boundary?.ctx ?? next
    if (boundary?.stopReason !== undefined) {
      recordUnreached(
        run,
        units.slice(index + 1),
        boundary.stopStatus ?? 'cancelled',
        boundary.stopReason,
      )
      return after
    }
    return fold(after, index + 1, history)
  }
  return fold(start, 0, [])
}

/**
 * The serial case, for callers that have a list of Activities and no Stages.
 *
 * The revise loop is the honest example: it re-runs one Activity and then one
 * reviewer, which is a sequence by construction and has no Stage to belong
 * to. Expressed as one Unit per activity, which is what serial means.
 */
export const runActivities = (
  params: Readonly<{
    run: TRun
    activities: readonly TActivity[]
    start: TActivityContext
    approveAfter?: readonly string[]
    onWaiting?: (waiting: TWaiting) => void
    hasSuccessor?: boolean
    trust?: number
    ledger?: TAttemptLedger
    cause?: string
  }>,
): Promise<TActivityContext> => {
  const { activities, ...rest } = params

  return runUnits({
    ...rest,
    units: activities.map((activity) => ({
      stage: activity.name,
      strategy: 'serial' as const,
      activities: [activity],
      endsStage: true,
    })),
  })
}
