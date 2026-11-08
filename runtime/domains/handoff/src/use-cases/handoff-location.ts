/**
 * Where a run's handoff documents go, before anything touches disk.
 *
 * Pure: no filesystem, no process. `start-session.ts` is the one caller that
 * turns this into an actual directory, so this module can be tested without
 * a tmpdir for every case.
 */

import { isAbsolute, join, resolve } from 'node:path'

export const HANDOFF_DIRNAME = 'context_handoff'

/** Both spellings a `--handoff` value may use for the run's own id. */
export const RUN_ID_TOKENS = ['{session_id}', '{run_id}'] as const

/** Today's path, unchanged: `<data_dir>/sessions/<run_id>/context_handoff`. */
export const defaultHandoffDir = (dataDir: string, runId: string): string =>
  resolve(join(dataDir, 'sessions', runId, HANDOFF_DIRNAME))

/**
 * Absolute. `override` undefined means the default. Throws on an empty
 * override, the same way `--commit true` is refused: typing the flag with
 * nothing after it is a mistake, not a request for the default.
 */
export const resolveHandoffDir = (
  params: Readonly<{
    repoRoot: string
    dataDir: string
    runId: string
    override: string | undefined
  }>,
): string => {
  const { repoRoot, dataDir, runId, override } = params
  if (override === undefined) {
    return defaultHandoffDir(dataDir, runId)
  }
  if (override === '') {
    throw new Error(
      "--handoff takes a path (got ''). Drop the flag for the default directory.",
    )
  }
  const expanded = RUN_ID_TOKENS.reduce(
    (value, token) => value.split(token).join(runId),
    override,
  )
  return resolve(isAbsolute(expanded) ? expanded : join(repoRoot, expanded))
}

/**
 * True when the resolved directory carries no run id, so another run pointed
 * at the same value would share it.
 */
export const isSharedHandoffDir = (resolved: string, runId: string): boolean =>
  !resolved.includes(runId)
