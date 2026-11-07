/**
 * Resume: run an activity run, or replay the one this session already passed.
 *
 * `skipIfDone` takes the replay as an ARGUMENT rather than inferring it. A
 * skipped activityRun has no body to produce the caller's return value, so a resume
 * primitive that cannot say how an activity run is replayed would have to invent one —
 * and every call site would be typed over a hole. Making the replay explicit
 * forces whoever adds an activity run to answer "how is this rehydrated", which is the
 * question resume actually turns on.
 *
 * A skipped activityRun opens NO new activityRun row. The trace already holds the
 * successful one, and writing a second would corrupt the completed set the next
 * resume reads — the reporter and resume would then disagree, which is the one
 * thing this design exists to prevent.
 *
 * `runActivityRun` itself is untouched. It is the system's error boundary, and
 * threading an optional replay through it would put a conditional inside the
 * one function that must stay simple enough to trust.
 */

import type { TActivityRunParams } from '../typedefs/activity-run'
import type { TActivityRunHandle, TRun } from '../typedefs/run'
import type { TEventPayload } from '../typedefs/trace'
import { latestLogPayload, readRunState } from './read-run-state'
import { runActivityRun } from './run-activity-run'

/** Event name a code activityRun files its verdict under, for replay. */
export const STEP_RESULT_EVENT = 'step_result'

/**
 * Record what a code activityRun decided, in a form replay can read back.
 *
 * Deliberately separate from `handle.log`: the console echoes every logged line
 * as a `log` event too, so "the activity-run's last log" is usually a human sentence.
 * The verdict gets its own event name.
 */
export const recordStepResult = (
  run: TRun,
  handle: TActivityRunHandle,
  payload: TEventPayload,
): void => {
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: handle.activityRun.activity_run_id,
    type: 'log',
    name: STEP_RESULT_EVENT,
    payload,
  })
}

/** The verdict a previous run of `activityRunName` recorded, or undefined. */
export const replayStepResult = (
  run: TRun,
  activityRunName: string,
): TEventPayload | undefined => {
  const state = readRunState(run.cfg.observability.db, run.runId)
  return state === undefined
    ? undefined
    : latestLogPayload(state, activityRunName, STEP_RESULT_EVENT)
}

export const skipIfDone = <TResult>(
  run: TRun,
  params: TActivityRunParams,
  body: (handle: TActivityRunHandle) => TResult | Promise<TResult>,
  replay: () => Promise<TResult>,
): Promise<TResult> => {
  /*
   * `run.resume` names what the TRACE already holds successful — it says
   * nothing about THIS process, and never changes after `createRun`. A gate
   * failure that asks for the same `params.name` again, in the same run, is
   * not a second resume: it is the run's own decision to retry, and has to
   * execute the body or it replays the same pre-resume result forever,
   * never spending an attempt and never converging (observed as a hang in
   * session 4b957b3a: `build` replayed on every gate-failure retry).
   * `run.activityRuns()` already answers "has this process served this name
   * before", so a second ask within it is told apart without a new field on
   * `TRun` or a mutation of the resume set other call sites read.
   */
  const alreadyServedThisRun = run
    .activityRuns()
    .some((activityRun) => activityRun.params.name === params.name)
  if (!run.resume.has(params.name) || alreadyServedThisRun) {
    return runActivityRun(run)(params, body)
  }
  run.tracer.event({
    run_id: run.runId,
    type: 'log',
    name: 'activity_run_skipped',
    payload: {
      activityRun: params.name,
      reason: 'already successful in this session',
    },
  })
  run.console.note(`skip ${params.name}: already successful in this session`)
  /*
   * A skipped activityRun still counts as one of this run's activityRuns.
   *
   * `finish` decides the run by what `run.activityRuns()` holds, and a resumed run
   * that re-runs nothing recorded nothing — so a chain whose every stage had
   * already succeeded was reported FAILED, having done everything asked of
   * it. Recording the replay keeps the verdict about the work rather than
   * about which process happened to do it.
   */
  run.recordActivityRun({
    activity_run_id: `${run.runId}_replayed_${params.name}`,
    run_id: run.runId,
    seq: 0,
    params,
    status: 'success',
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
  })
  return replay()
}

/**
 * `runActivityRun(run)`, with a replay. The drop-in for a hand-written workflow.
 *
 * Same shape as `runActivityRun` so adopting resume in an existing workflow is one
 * extra argument per call rather than a rewrite.
 */
export const resumableActivityRun =
  (run: TRun) =>
  <TResult>(
    params: TActivityRunParams,
    body: (handle: TActivityRunHandle) => TResult | Promise<TResult>,
    replay: () => Promise<TResult>,
  ): Promise<TResult> =>
    skipIfDone(run, params, body, replay)
