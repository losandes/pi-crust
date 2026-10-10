/**
 * Resume: run a phase, or replay the one this session already passed.
 *
 * `skipIfDone` takes the replay as an ARGUMENT rather than inferring it. A
 * skipped phase has no body to produce the caller's return value, so a resume
 * primitive that cannot say how a phase is replayed would have to invent one —
 * and every call site would be typed over a hole. Making the replay explicit
 * forces whoever adds a phase to answer "how is this rehydrated", which is the
 * question resume actually turns on.
 *
 * A skipped phase opens NO new phase row. The trace already holds the
 * successful one, and writing a second would corrupt the completed set the next
 * resume reads — the reporter and resume would then disagree, which is the one
 * thing this design exists to prevent.
 *
 * `runPhase` itself is untouched. It is the system's error boundary, and
 * threading an optional replay through it would put a conditional inside the
 * one function that must stay simple enough to trust.
 */

import type { TPhaseParams } from '../typedefs/phase'
import type { TPhaseHandle, TRun } from '../typedefs/run'
import type { TEventPayload } from '../typedefs/trace'
import { latestLogPayload, readRunState } from './read-run-state'
import { runPhase } from './run-phase'

/** Event name a code phase files its verdict under, for replay. */
export const STEP_RESULT_EVENT = 'step_result'

/**
 * Record what a code phase decided, in a form replay can read back.
 *
 * Deliberately separate from `handle.log`: the console echoes every logged line
 * as a `log` event too, so "the phase's last log" is usually a human sentence.
 * The verdict gets its own event name.
 */
export const recordStepResult = (
  run: TRun,
  handle: TPhaseHandle,
  payload: TEventPayload,
): void => {
  run.tracer.event({
    run_id: run.runId,
    phase_id: handle.phase.phase_id,
    type: 'log',
    name: STEP_RESULT_EVENT,
    payload,
  })
}

/** The verdict a previous run of `phaseName` recorded, or undefined. */
export const replayStepResult = (
  run: TRun,
  phaseName: string,
): TEventPayload | undefined => {
  const state = readRunState(run.cfg.observability.db, run.runId)
  return state === undefined
    ? undefined
    : latestLogPayload(state, phaseName, STEP_RESULT_EVENT)
}

export const skipIfDone = <TResult>(
  run: TRun,
  params: TPhaseParams,
  body: (handle: TPhaseHandle) => TResult | Promise<TResult>,
  replay: () => Promise<TResult>,
): Promise<TResult> => {
  if (!run.resume.has(params.name)) {
    return runPhase(run)(params, body)
  }
  run.tracer.event({
    run_id: run.runId,
    type: 'log',
    name: 'phase_skipped',
    payload: {
      phase: params.name,
      reason: 'already successful in this session',
    },
  })
  run.console.note(`skip ${params.name}: already successful in this session`)
  /*
   * A skipped phase still counts as one of this run's phases.
   *
   * `finish` decides the run by what `run.phases()` holds, and a resumed run
   * that re-runs nothing recorded nothing — so a chain whose every stage had
   * already succeeded was reported FAILED, having done everything asked of
   * it. Recording the replay keeps the verdict about the work rather than
   * about which process happened to do it.
   */
  run.recordPhase({
    phase_id: `${run.runId}_replayed_${params.name}`,
    run_id: run.runId,
    seq: 0,
    params,
    status: 'success',
    attempt: 0,
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
  })
  return replay()
}

/**
 * `runPhase(run)`, with a replay. The drop-in for a hand-written workflow.
 *
 * Same shape as `runPhase` so adopting resume in an existing workflow is one
 * extra argument per call rather than a rewrite.
 */
export const resumablePhase =
  (run: TRun) =>
  <TResult>(
    params: TPhaseParams,
    body: (handle: TPhaseHandle) => TResult | Promise<TResult>,
    replay: () => Promise<TResult>,
  ): Promise<TResult> =>
    skipIfDone(run, params, body, replay)
