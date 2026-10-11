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
import { regressionOf } from '../typedefs/envelope'
import { phaseParams } from '../typedefs/phase'
import type { TRun } from '../typedefs/run'
import type { TStep, TStepContext, TUpstream } from '../typedefs/step'
import type { TUnit } from '../typedefs/unit'
import { activityGates, wantsStageGate } from '../typedefs/unit'
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

/**
 * How often one stage may be returned to before the developer is asked.
 *
 * One. A stage returned to twice is two agents disagreeing at a build-sized
 * price per lap, and no amount of further looping settles that.
 */
export const MAX_RETURNS_PER_STAGE = 1

/** The phase row a gate event should hang off, best effort. */
const handleIdOf = (run: TRun, stepName: string): string =>
  run.phases().findLast((phase) => phase.params.name === stepName)
    ?.phase_id ?? ''

/**
 * The engineer phase every chain opens with: the ask, on the record.
 *
 * Skippable like any other phase, so a resumed run does not re-record a request
 * it already has.
 */
export const recordRequest = (
  run: TRun,
  prompt: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> =>
  skipIfDone(
    run,
    phaseParams({
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
const runUnit = async (
  run: TRun,
  unit: TUnit,
  ctx: TStepContext,
): Promise<readonly TRan[]> => {
  const one = (step: TStep): Promise<TRan> =>
    skipIfDone(
      run,
      step.params,
      (handle) => step.execute(ctx, handle),
      () => step.replay(ctx),
    ).then((result) => ({ step, result }))

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
    phase_id: '',
    type: 'log',
    name: 'stage_disagreement',
    payload: { stage: unit.stage, outcomes: split },
  })
}

export const runUnits = (
  run: TRun,
  units: readonly TUnit[],
  start: TStepContext,
  approveAfter: readonly string[] = [],
  onWaiting: (waiting: TWaiting) => void = () => undefined,
  trust: number = TRUST_DEFAULT,
): Promise<TStepContext> => {
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
    const ran = await runUnit(run, unit, ctx)
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
            stage: one.step.name,
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
          ? `waiting for you: '${gate.stage}' escalated ${gate.questions.length} ` +
              `question(s) it may not settle at this trust level — ${path}`
          : `waiting for you: approval requested after '${gate.stage}' — ${path}`,
      )
      run.tracer.event({
        run_id: run.runId,
        phase_id: handleIdOf(run, gate.stage),
        type: 'log',
        name: 'human_gate_open',
        payload: {
          stage: gate.stage,
          unit: unit.stage,
          kind: gate.kind,
          request: path,
        },
      })
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
          phase_id: handleIdOf(run, one.step.name),
          type: 'log',
          name: 'self_answered',
          payload: { stage: one.step.name, ...decided, trust },
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
        phase_id: handleIdOf(run, step.name),
        type: 'log',
        name: 'open_questions',
        payload: { stage: step.name, questions: trailing },
      })
    }

    const verdict = regressionVerdict({
      request: regressionOf(result?.previous),
      names,
      askedAt: startOf(index),
      history,
      maxReturnsPerStage: MAX_RETURNS_PER_STAGE,
    })

    if (verdict.kind === 'refused' || verdict.kind === 'exhausted') {
      // Not a throw: the stage did its job and said something true. The run
      // is what cannot continue, and `finish` settles that with the reason.
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
  run: TRun,
  steps: readonly TStep[],
  start: TStepContext,
  approveAfter: readonly string[] = [],
  onWaiting: (waiting: TWaiting) => void = () => undefined,
  trust: number = TRUST_DEFAULT,
): Promise<TStepContext> =>
  runUnits(
    run,
    steps.map((step) => ({
      stage: step.name,
      strategy: 'serial' as const,
      steps: [step],
      endsStage: true,
    })),
    start,
    approveAfter,
    onWaiting,
    trust,
  )
