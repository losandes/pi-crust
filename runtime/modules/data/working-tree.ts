/**
 * Fingerprinting the working tree — what permission enforcement compares.
 */

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

/*
 * There is no `deletePath` here, and there must not be one.
 *
 * It existed to unlink an untracked file an agent was thought to have
 * introduced, and "thought to have" is the whole problem: a developer
 * creating a file in their own tree while a run works is indistinguishable
 * from an agent doing it, and deleting the wrong one leaves nothing to
 * recover from — no commit, no stash, no index entry. The tree is the
 * developer's; pi-crust reports what it sees in it.
 */
