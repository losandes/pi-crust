/**
 * Instructions a person sent a run back with.
 *
 * Append-only, like the inbox and for the same reason: a run steered twice
 * has been steered twice, and the second instruction rarely cancels the
 * first. Rewriting the file would quietly drop the earlier one, and an agent
 * that never saw it cannot be blamed for ignoring it.
 *
 * It lives in the handoff directory because that is where this run's shared
 * context already lives, and it is the one file there that belongs to the
 * developer rather than to a activity.
 */

import { join } from 'node:path'
import { appendText, fileExists, readText } from './files'

export const STEERING_FILENAME = 'steering.md'

export const steeringPath = (handoffDir: string): string =>
  join(handoffDir, STEERING_FILENAME)

/** Everything this run has been told, oldest first. Empty when never steered. */
export const readSteering = (handoffDir: string): string => {
  const path = steeringPath(handoffDir)
  return fileExists(path) ? readText(path) : ''
}

/** Add one instruction. Returns where it went, for the developer to read. */
export const appendSteering = (handoffDir: string, entry: string): string => {
  const path = steeringPath(handoffDir)
  appendText(path, entry.endsWith('\n') ? entry : `${entry}\n`)
  return path
}
