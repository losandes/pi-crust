/**
 * The step driver: fold a context through an ordered list of steps.
 *
 * Every step goes through `skipIfDone`, so `--resume` works on every workflow
 * built this way without any workflow knowing resume exists.
 *
 * It does NOT call `finish`. The workflow does, because a workflow may have an
 * acceptance criterion of its own on top of the steps' — and `finish` must be
 * called exactly once, by whoever owns the run.
 */

import { regressionOf } from '../typedefs/envelope'
import { phaseParams } from '../typedefs/phase'
import type { TRun } from '../typedefs/run'
import type { TStep, TStepContext } from '../typedefs/step'
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

export const runSteps = (
  run: TRun,
  steps: readonly TStep[],
  start: TStepContext,
  approveAfter: readonly string[] = [],
  onWaiting: (waiting: TWaiting) => void = () => undefined,
  trust: number = TRUST_DEFAULT,
): Promise<TStepContext> => {
  const names = steps.map((step) => step.name)

  const fold = async (
    ctx: TStepContext,
    index: number,
    history: readonly TRegressionRecord[],
  ): Promise<TStepContext> => {
    const step = steps[index]
    if (step === undefined) {
      return ctx
    }
    const result = await skipIfDone(
      run,
      step.params,
      (handle) => step.execute(ctx, handle),
      () => step.replay(ctx),
    )
    const next: TStepContext = {
      ...ctx,
      previous: result.previous,
      previousStep: step.name,
      outcomes: [
        ...ctx.outcomes,
        { step: step.name, accepted: result.accepted },
      ],
    }

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
    const replayed = run.resume.has(step.name)
    const gate = replayed
      ? undefined
      : gateReason({
          stage: step.name,
          envelope: result.previous,
          approveAfter,
          hasSuccessor: index + 1 < steps.length,
          trust,
        })
    if (gate !== undefined) {
      const path = writeDecisionRequest(
        run.contextHandoffDir,
        gate,
        run.runId,
        resumeInvocation(process.argv, run.runId),
      )
      run.console.note(
        gate.kind === 'escalated'
          ? `waiting for you: '${step.name}' escalated ${gate.questions.length} ` +
              `question(s) it may not settle at this trust level — ${path}`
          : `waiting for you: approval requested after '${step.name}' — ${path}`,
      )
      run.tracer.event({
        run_id: run.runId,
        phase_id: handleIdOf(run, step.name),
        type: 'log',
        name: 'human_gate_open',
        payload: { stage: step.name, kind: gate.kind, request: path },
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
    for (const decided of selfAnswered(result.previous, trust)) {
      run.console.note(
        `'${step.name}' answered its own question: ${decided.question} → ${decided.answer}`,
      )
      run.tracer.event({
        run_id: run.runId,
        phase_id: handleIdOf(run, step.name),
        type: 'log',
        name: 'self_answered',
        payload: { stage: step.name, ...decided, trust },
      })
    }

    const trailing =
      index + 1 < steps.length
        ? []
        : blockingQuestions(result.previous, trust)
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
      request: regressionOf(result.previous),
      names,
      askedAt: index,
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
        because: regressionOf(result.previous)?.because ?? '',
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
      return fold(next, verdict.index, [...history, record])
    }

    return fold(next, index + 1, history)
  }
  return fold(start, 0, [])
}
