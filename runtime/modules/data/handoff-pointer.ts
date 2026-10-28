/**
 * The pointer that tells every out-of-process reader where a run's handoff
 * documents actually live.
 *
 * `context_handoff/` has always lived at a fixed path under `data_dir`. With
 * `--handoff` it can move, and the session directory it moved out of never
 * does — `events.jsonl`, `invocation.json` and the rest stay put. A reader
 * that only has the run id (`decide.ts`, the visualizer) needs one more fact
 * to find the directory, and this file is it: one absolute path, written once
 * at session start, read by anyone who asks.
 */

import { join } from 'node:path'
import { defaultHandoffDir } from '../use-cases/handoff-location'
import { fileExists, readText, writeText } from './files'

export const HANDOFF_POINTER_FILENAME = 'handoff-dir'

/** `<data_dir>/sessions/<run_id>/handoff-dir` — the canonical session directory. */
const pointerPath = (sessionDir: string): string =>
  join(sessionDir, HANDOFF_POINTER_FILENAME)

/** Record where this run's handoff directory actually is. */
export const writeHandoffPointer = (
  sessionDir: string,
  handoffDir: string,
): void => {
  writeText(pointerPath(sessionDir), `${handoffDir}\n`)
}

/** The absolute path this run recorded, or undefined when it recorded none. */
export const recordedHandoffDir = (sessionDir: string): string | undefined => {
  const path = pointerPath(sessionDir)
  if (!fileExists(path)) {
    return undefined
  }
  const recorded = readText(path).trim()
  return recorded === '' ? undefined : recorded
}

/**
 * The pointer, or the canonical default. What every out-of-process reader
 * calls instead of reconstructing the path from the run id.
 */
export const handoffDirFor = (dataDir: string, runId: string): string =>
  recordedHandoffDir(join(dataDir, 'sessions', runId)) ??
  defaultHandoffDir(dataDir, runId)
