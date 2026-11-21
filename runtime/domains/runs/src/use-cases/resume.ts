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

import type {
  TActivityRunHandle,
  TActivityRunParams,
  TEventPayload,
  TRun,
} from '../../../../lib/contracts'
import { latestLogPayload, readRunState } from '../../../trace'
import { runActivityRun } from './run-activity-run'
import { supersedeReplacedAttempts } from './supersede-replaced-attempts'

/** Event name a code activityRun files its verdict under, for replay. */
export const STEP_RESULT_EVENT = 'step_result'

/** The id a replayed Activity Run carries. It is never written to the trace. */
export const replayedActivityRunId = (runId: string, name: string): string =>
  `${runId}_replayed_${name}`

/** Is this id one `skipIfDone` minted for a replay, rather than a real row? */
export const isReplayedActivityRunId = (
  runId: string,
  activityRunId: string,
): boolean => activityRunId.startsWith(`${runId}_replayed_`)

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
  const state = readRunState(run.tracer.dbPath, run.runId)
  return state === undefined
    ? undefined
    : latestLogPayload(state, activityRunName, STEP_RESULT_EVENT)
}

/** A person's retry replaces its unfinished attempt, including across processes. */
const supersedeWaiting = (run: TRun, name: string): void => {
  const waiting = run.tracer
    .activityRunsFor(run.runId)
    .filter((one) => one.params.name === name && one.status === 'waiting')
  for (const previous of waiting) {
    const inMemory = run
      .activityRuns()
      .some((one) => one.activity_run_id === previous.activity_run_id)
    const updated = inMemory
      ? run.updateActivityRun(previous.activity_run_id, {
          status: 'superseded',
        })
      : { ...previous, status: 'superseded' as const }
    run.tracer.activityRunUpsert(updated)
  }
}

export const skipIfDone = <TResult>(
  run: TRun,
  params: TActivityRunParams,
  body: (handle: TActivityRunHandle) => TResult | Promise<TResult>,
  replay: () => Promise<TResult>,
): Promise<TResult> => {
  if (!run.claimResume(params.name)) {
    return runActivityRun(run)(params, (handle) => {
      supersedeWaiting(run, params.name)
      supersedeReplacedAttempts(run)
      return body(handle)
    })
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
    activity_run_id: replayedActivityRunId(run.runId, params.name),
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
