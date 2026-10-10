/**
 * Fingerprinting the working tree — what permission enforcement compares.
 */

import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseSettlement } from '../typedefs/settlement'
import { gitOutput } from './git'

export type TTreeSnapshot = Readonly<Record<string, string>>

/**
 * Fingerprint every path the working tree currently differs on.
 *
 * Tracked files carry their numstat counts, so an edit to an already-dirty file
 * still registers as a change. Untracked files are listed by name. Gitignored
 * paths never appear, which is why the session runtime under `data_dir` — where
 * handoff files legitimately land — needs no special case.
 */
export const snapshotTree = (repoRoot: string): TTreeSnapshot => {
  const tracked = gitOutput(['diff', 'HEAD', '--numstat'], repoRoot)
    .split('\n')
    .flatMap((line) => {
      const fields = line.split('\t')
      const path = fields.at(-1)?.trim() ?? ''
      return fields.length >= 3 && path
        ? [[path, `${fields[0]},${fields[1]}`] as const]
        : []
    })
  const untracked = gitOutput(
    ['ls-files', '--others', '--exclude-standard'],
    repoRoot,
  )
    .split('\n')
    .flatMap((line) =>
      line.trim() ? [[line.trim(), 'untracked'] as const] : [],
    )
  return Object.fromEntries([...tracked, ...untracked])
}

/** Delete an untracked file the agent introduced. */
export const deletePath = (
  repoRoot: string,
  path: string,
): Readonly<{ deleted: boolean; reason: string }> => {
  const settled = safeParseSettlement(() => unlinkSync(join(repoRoot, path)))
  return settled.status === 'ok'
    ? { deleted: true, reason: '' }
    : { deleted: false, reason: settled.error.message }
}
