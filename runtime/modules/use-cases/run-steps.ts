/**
 * The driver: fold a context through an ordered list of Work Units.
 *
 * A Unit is one Activity, or a whole concurrent Stage. The fold does not
 * branch on which: it runs the Unit's steps, composes whatever they produced
 * into the context, and then gates. Everything that distinguishes serial from
 * concurrent was decided when the Units were built.
 *
 * Every step goes through `skipIfDone`, so `--resume` works on every workflow
 * built this way without any workflow knowing resume exists.
 *
 * It does NOT call `finish`. The workflow does, because a workflow may have an
 * acceptance criterion of its own on top of the steps' — and `finish` must be
 * called exactly once, by whoever owns the run.
 */

import { errorMessage } from '../typedefs/settlement'
import { buildOutput, narrowEnvelope, regressionOf } from '../typedefs/envelope'
import type { TEnvelopeBase } from '../typedefs/envelope'
import { violationsOf } from '../typedefs/gate'
import { activityRunParams } from '../typedefs/activity-run'
import type { TActivityRun } from '../typedefs/activity-run'
import type { TRun } from '../typedefs/run'
import type { TStep, TStepContext, TUpstream } from '../typedefs/step'
import type { TUnit } from '../typedefs/unit'
import { activityGates, wantsStageGate } from '../typedefs/unit'
import type { TAttemptLedger } from './attempts'
import {
  attemptLedger,
  FIRST_ATTEMPT,
  gateCause,
  regressionCause,
} from './attempts'
import { commitActivity } from './deliver'
import type { TGateReason } from './human-gate'
import { TRUST_DEFAULT } from '../typedefs/trust'
import {
  blockingQuestions,
  gateReason,
  selfAnswered,
  resumeInvocation,
  writeDecisionRequest,
} from './human-gate'
import type { TRegressionRecord } from './regression'
import { regressionNote, regressionVerdict } from './regression'
import { skipIfDone } from './resume'

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
type TRan = Readonly<{ step: TStep; result: Awaited<ReturnType<TStep['execute']>> }>

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
  ctx: TStepContext,
  step: TStep,
  ledger: TAttemptLedger,
  params: Readonly<{ cause: string; feedback: readonly string[] }>,
): Promise<TRan> => {
  /*
   * Each Activity is told who else is running, and never itself. Permission
   * enforcement uses it to attribute a write by the path it landed on rather
   * than by the window it landed in.
   */
  const given: TStepContext = {
    ...ctx,
    cohort:
      unit.strategy === 'concurrent'
        ? unit.steps
            .filter((other) => other.name !== step.name)
            .map((other) => other.name)
        : [],
    feedback: params.feedback,
  }

  return skipIfDone(
    run,
    step.params,
    (handle) => {
      ledger.spend(step.instance, params.cause)

      return step.execute(given, handle)
    },
    () => step.replay(given),
  ).then((result) => ({ step, result }))
}

const runUnit = async (
  run: TRun,
  unit: TUnit,
  ctx: TStepContext,
  ledger: TAttemptLedger,
): Promise<readonly TRan[]> => {
  const one = (step: TStep): Promise<TRan> =>
    runStep(run, unit, ctx, step, ledger, {
      cause: FIRST_ATTEMPT,
      feedback: [],
    })

  if (unit.strategy !== 'concurrent') {
    return await unit.steps.reduce<Promise<readonly TRan[]>>(
      async (sofar, step) => [...(await sofar), await one(step)],
      Promise.resolve([]),
    )
  }

  const settled = await Promise.allSettled(unit.steps.map(one))
  const failures = settled.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  )
  const done = settled.flatMap((outcome) =>
    outcome.status === 'fulfilled' ? [outcome.value] : [],
  )
  if (failures.length > 0) {
    throw new Error(
      `stage '${unit.stage}' lost ${failures.length} of ${unit.steps.length} ` +
        `activities; ${done.length} completed first and are in the trace:\n` +
        failures.map((reason) => `  - ${errorMessage(reason)}`).join('\n'),
    )
  }

  return done
}

/** What an Activity says it changed — what a gate reading the tree judges. */
const claimedPaths = (envelope: TEnvelopeBase): readonly string[] =>
  narrowEnvelope(buildOutput, envelope)?.changed_files ?? []

/**
 * Judge one Activity's gates, recording every one of them.
 *
 * At the UNIT boundary, which in a concurrent Stage is the Stage boundary.
 * That is not a nicety: `checks` runs the repository's own commands against
 * the working tree, and a sibling Activity may still be writing to it.
 */
const judgeGates = (
  run: TRun,
  step: TStep,
  envelope: TEnvelopeBase,
): readonly string[] => {
  const activityRun = activityRunFor(run, step.instance)
  if (activityRun === undefined) {
    return []
  }

  return step.gates.flatMap((gate) => {
    const report = gate.check(envelope, run, claimedPaths(envelope))
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
  run: TRun,
  unit: TUnit,
  ctx: TStepContext,
  ran: readonly TRan[],
  ledger: TAttemptLedger,
): Promise<readonly TRan[]> => {
  const settleOne = async (entry: TRan): Promise<TRan> => {
    const envelope = entry.result.previous
    if (envelope === undefined || entry.step.gates.length === 0) {
      return entry
    }
    const violations = judgeGates(run, entry.step, envelope)
    if (violations.length === 0) {
      if (entry.step.commit) {
        commitActivity(
          run,
          entry.step.instance,
          handleIdOf(run, entry.step.instance),
          envelope,
        )
      }

      return entry
    }
    const standing = activityRunFor(run, entry.step.instance)
    if (ledger.remaining(entry.step.instance, entry.step.attempts) === 0) {
      // The row said success because the Activity ran; its work is what did
      // not hold, and a trace that leaves it green is a trace that disagrees
      // with the reason the run stopped.
      if (standing !== undefined) {
        run.tracer.activityRunUpsert(
          run.updateActivityRun(standing.activity_run_id, { status: 'fail' }),
        )
      }
      throw new Error(
        `${entry.step.instance} failed its gates and has no attempts left:\n- ` +
          `${violations.join('\n- ')}\n\n` +
          ledger.report(entry.step.instance, entry.step.attempts),
      )
    }
    if (standing !== undefined) {
      run.tracer.activityRunUpsert(
        run.updateActivityRun(standing.activity_run_id, {
          status: 'superseded',
        }),
      )
    }
    run.console.note(
      `${entry.step.instance}: ${violations.length} gate violation(s) — ` +
        'running it again ' +
        `(attempt ${ledger.spent(entry.step.instance) + 1} of ${entry.step.attempts})`,
    )

    return settleOne(
      await runStep(run, unit, ctx, entry.step, ledger, {
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
  const names = remaining.flatMap((unit) => unit.steps.map((step) => step.name))
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
  if (ran.length < 2 || accepted.length === 0 || accepted.length === ran.length) {
    return
  }
  const split = ran
    .map((one) => `${one.step.name} ${one.result.accepted ? 'accepted' : 'rejected'}`)
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
  start: TStepContext
  approveAfter?: readonly string[]
  onWaiting?: (waiting: TWaiting) => void
  trust?: number
  ledger?: TAttemptLedger
}>

export const runUnits = (params: TRunUnitsParams): Promise<TStepContext> => {
  const { run, units, start } = params
  const approveAfter = params.approveAfter ?? []
  const onWaiting = params.onWaiting ?? (() => undefined)
  const trust = params.trust ?? TRUST_DEFAULT
  const ledger = params.ledger ?? attemptLedger()
  const names = units.flatMap((unit) => unit.steps.map((step) => step.name))
  const gatedActivities = activityGates(approveAfter)

  /** Where in `names` a Unit's first Activity sits, for the regression rules. */
  const startOf = (index: number): number =>
    units.slice(0, index).reduce((sofar, unit) => sofar + unit.steps.length, 0)

  /** The Unit that holds a named Activity, for a regression's destination. */
  const unitHolding = (name: string): number =>
    units.findIndex((unit) => unit.steps.some((step) => step.name === name))

  const fold = async (
    ctx: TStepContext,
    index: number,
    history: readonly TRegressionRecord[],
  ): Promise<TStepContext> => {
    const unit = units[index]
    if (unit === undefined) {
      return ctx
    }
    const ran = await settleGates(
      run,
      unit,
      ctx,
      await runUnit(run, unit, ctx, ledger),
      ledger,
    )
    noteDisagreement(run, unit, ran)

    const upstream: readonly TUpstream[] = ran.flatMap((one) =>
      one.result.previous === undefined
        ? []
        : [{ step: one.step.name, envelope: one.result.previous }],
    )
    /*
     * The envelope a single-upstream consumer reads.
     *
     * Serially this is the Activity that just ran, exactly as before. From a
     * concurrent Stage it is the first in declaration order — deterministic,
     * so two runs of the same configuration produce the same trace, and
     * never the whole story. `upstream` is the whole story, and an agent is
     * given all of it.
     */
    const primary = ran[0]
    const last = ran.at(-1)
    const next: TStepContext = {
      ...ctx,
      previous:
        unit.strategy === 'concurrent'
          ? primary?.result.previous
          : last?.result.previous,
      previousStep:
        unit.strategy === 'concurrent' ? primary?.step.name : last?.step.name,
      upstream,
      cohort: [],
      outcomes: [
        ...ctx.outcomes,
        ...ran.map((one) => ({
          step: one.step.name,
          accepted: one.result.accepted,
        })),
      ],
    }

    const step = (unit.strategy === 'concurrent' ? primary : last)?.step
    if (step === undefined) {
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
    const replayed = ran.every((one) => run.resume.has(one.step.name))
    /*
     * A stage gate is spelled `stage:<name>` and only fires on the Unit that
     * ends the Stage. In a serial Stage that is its last Activity, so
     * `--approve-after stage:design` stops after the Stage rather than after
     * the first thing in it; in a concurrent Stage there is only one Unit,
     * which is the same place.
     */
    const stageGated = unit.endsStage && wantsStageGate(approveAfter, unit.stage)
    const gates = replayed
      ? []
      : ran.flatMap((one) => {
          const reason = gateReason({
            activity: one.step.name,
            envelope: one.result.previous,
            approveAfter: stageGated
              ? [...gatedActivities, one.step.name]
              : gatedActivities,
            hasSuccessor: index + 1 < units.length,
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
        activity_run_id: handleIdOf(run, gate.activity),
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
          `'${one.step.name}' answered its own question: ${decided.question} → ${decided.answer}`,
        )
        run.tracer.event({
          run_id: run.runId,
          activity_run_id: handleIdOf(run, one.step.name),
          type: 'log',
          name: 'self_answered',
          payload: { activity: one.step.name, ...decided, trust },
        })
      }
    }

    const trailing =
      index + 1 < units.length
        ? []
        : blockingQuestions(result?.previous, trust)
    if (trailing.length > 0) {
      run.console.note(
        `'${step.name}' finished the chain with ${trailing.length} open ` +
          'question(s) — nothing is blocked, but they are yours to answer:',
      )
      for (const question of trailing) {
        run.console.note(`  - ${question}`)
      }
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: handleIdOf(run, step.name),
        type: 'log',
        name: 'open_questions',
        payload: { activity: step.name, questions: trailing },
      })
    }

    /*
     * A regression spends from the destination's own budget, like every
     * other autonomous re-execution. It was a separate cap of one per
     * stage, which let a bad input burn a gate retry, a revision AND a lap
     * of the chain before anybody was asked.
     */
    const destination = units
      .flatMap((one) => one.steps)
      .find((step) => step.name === regressionOf(result?.previous)?.activity)
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
        payload: { from: step.name, reason: verdict.reason },
      })
      return {
        ...next,
        outcomes: [...next.outcomes, { step: step.name, accepted: false }],
      }
    }

    if (verdict.kind === 'regress') {
      const record: TRegressionRecord = {
        from: step.name,
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
          regressionCause(step.name, record.because),
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

    return fold(next, index + 1, history)
  }
  return fold(start, 0, [])
}

/**
 * The serial case, for callers that have a list of Activities and no Stages.
 *
 * The revise loop is the honest example: it re-runs one Activity and then one
 * reviewer, which is a sequence by construction and has no Stage to belong
 * to. Expressed as one Unit per step, which is what serial means.
 */
export const runSteps = (
  params: Readonly<{
    run: TRun
    steps: readonly TStep[]
    start: TStepContext
    approveAfter?: readonly string[]
    onWaiting?: (waiting: TWaiting) => void
    trust?: number
    ledger?: TAttemptLedger
  }>,
): Promise<TStepContext> => {
  const { steps, ...rest } = params

  return runUnits({
    ...rest,
    units: steps.map((step) => ({
      stage: step.name,
      strategy: 'serial' as const,
      steps: [step],
      endsStage: true,
    })),
  })
}
