/**
 * How a hand-written workflow's activityRuns are replayed under `--resume`.
 *
 * The activity library answers this per activity. The workflows with real control flow
 * — bounded fix loops, conditional tails — are not activities, so they say it at the
 * call site: `activityRun(params, body, replay)`. One extra argument, and the cost is
 * deliberate. A resume primitive that guessed how to rehydrate an activity run would
 * have to return `undefined as TResult` and launder a hole into every caller.
 *
 * Three sources, one per kind of activityRun:
 *
 *   agent  →  the envelope on disk, written the moment it parsed
 *   code   →  the verdict the activityRun recorded, under its own event name
 *   git    →  the capture is simply redone; it is deterministic and free
 */

import type {
  TActivityRunHandle,
  TChangeCapture,
  TChangeSet,
  TEnvelopeBase,
  TEnvelopeSpec,
  TQualityResult,
  TRun,
} from '../../../../lib/contracts'
import { readEnvelope } from '../../../activities'
import { captureChanges } from '../../../workspace'
import { recordStepResult, replayStepResult } from './resume'

/** A activityRun whose only product was the record of it happening. */
export const replayNothing = (): Promise<void> => Promise.resolve(undefined)

export const replayAgent =
  <TEnvelope extends TEnvelopeBase>(
    run: TRun,
    agentName: string,
    spec: TEnvelopeSpec<TEnvelope>,
  ): (() => Promise<TEnvelope>) =>
  () => {
    const settled = readEnvelope(run, agentName, spec)
    if (settled.status === 'error') {
      throw new Error(
        `cannot resume '${agentName}': ${settled.error.message}. Either drop ` +
          '--resume so the activityRun runs again, or run that activity on its own.',
      )
    }
    return Promise.resolve(settled.data)
  }

/**
 * Log a deterministic block's verdict — for humans, and for replay.
 *
 * The verdict is filed under its own event name because the console echoes
 * every printed line as a `log` too, so "the activity-run's last log" is usually a
 * sentence rather than a result.
 */
export const recordQuality = (
  run: TRun,
  handle: TActivityRunHandle,
  result: TQualityResult,
): void => {
  const passed = result.checks.filter((check) => check.passed).length
  handle.log({
    passed: result.passed,
    checks: `${passed}/${result.checks.length}`,
    artifacts: result.artifacts.join(', '),
  })
  recordStepResult(run, handle, {
    passed: result.passed,
    failures: [...result.failures],
    checks: result.checks.length,
    artifacts: [...result.artifacts],
  })
}

/**
 * The verdict a previous run recorded — NOT its activityRun status.
 *
 * A test activityRun that ran the suite did its job even when the suite came back
 * red, so `status === 'success'` says nothing about whether the code passed.
 * Inferring one from the other would reintroduce exactly the bug that
 * `finish(accepted:)` exists to prevent.
 */
export const replayQuality =
  (run: TRun, activityRunName: string): (() => Promise<TQualityResult>) =>
  () => {
    const payload = replayStepResult(run, activityRunName)
    if (payload === undefined) {
      throw new Error(
        `cannot resume '${activityRunName}': this session recorded no verdict for ` +
          'it. Drop --resume so the checks run again.',
      )
    }
    const failures = Array.isArray(payload.failures)
      ? (payload.failures as readonly string[])
      : []
    const artifacts = Array.isArray(payload.artifacts)
      ? (payload.artifacts as readonly string[])
      : []
    return Promise.resolve({
      passed: payload.passed === true,
      checks: [],
      failures: [...failures],
      artifacts: [...artifacts],
      unmatchedPaths: [],
    })
  }

/** The commit already landed; there is nothing to redo and nothing to undo. */
export const replayCommit =
  (run: TRun, activityRunName: string): (() => Promise<void>) =>
  () => {
    const payload = replayStepResult(run, activityRunName)
    run.console.note(
      `${activityRunName}: already committed as ${String(payload?.sha ?? '(unknown)')}`,
    )
    return Promise.resolve(undefined)
  }

/** Re-capture rather than reconstruct: a diff is deterministic and costs nothing. */
export const replayChanges =
  (run: TRun, capture: TChangeCapture): (() => Promise<TChangeSet>) =>
  () =>
    Promise.resolve(captureChanges(run, capture))
