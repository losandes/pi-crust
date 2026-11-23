/**
 * How a hand-written workflow's activityRuns are replayed under `--resume`.
 *
 * Composed workflows restore their run-wide context with
 * `replay-envelope-history.ts` before replaying individual Activities.
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
  TChangeCapture,
  TChangeSet,
  TEnvelopeBase,
  TEnvelopeSpec,
  TRun,
} from '../../../../lib/contracts'
import { readEnvelope } from '../../../activities'
import { captureChanges } from '../../../workspace'
import { replayStepResult } from './resume'

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
