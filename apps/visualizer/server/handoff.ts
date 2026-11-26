/**
 * Where a run's handoff documents actually are, for a UI that has no copy of
 * the runtime.
 *
 * `--handoff` can move `context_handoff/` out from under `data_dir`, and the
 * runtime records where it went in one pointer file beside the rest of the
 * session's machinery:
 * `<run-directory>/handoff-dir`. This is the same pointer, read by the
 * server instead of the CLI, so a relocated run still shows its documents and
 * an approval from the browser lands where the run is actually watching.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const HANDOFF_POINTER_FILENAME = 'handoff-dir'

/** The pointer, or the canonical default when no run ever recorded one. */
export const handoffDirFor = (runDir: string): string => {
  const pointer = join(runDir, HANDOFF_POINTER_FILENAME)
  if (existsSync(pointer)) {
    const recorded = readFileSync(pointer, 'utf8').trim()
    if (recorded !== '') return recorded
  }
  return join(runDir, 'context_handoff')
}
