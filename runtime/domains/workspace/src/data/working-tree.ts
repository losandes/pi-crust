/**
 * Working-tree fingerprints and paths changed in history for permission enforcement.
 */

import { gitOutput } from './git'
import type { TRoots } from './roots'
import { normaliseFromGit } from './roots'

export type TTreeSnapshot = Readonly<Record<string, string>>

export const historyPaths =
  (roots: TRoots) =>
  (from: string, to: string): readonly string[] =>
    from === '' || to === '' || from === to
      ? []
      : gitOutput(
          ['diff', '--name-only', '--no-renames', from, to, '--'],
          roots.vcsRoot,
        )
          .split('\n')
          .flatMap((line) =>
            line.trim() ? [normaliseFromGit(roots, line.trim())] : [],
          )

/**
 * Fingerprint every path the working tree currently differs on.
 *
 * Tracked files carry their numstat counts, so an edit to an already-dirty file
 * still registers as a change. Untracked files are listed by name. Gitignored
 * paths never appear, which is why the session runtime under `data_dir` — where
 * handoff files legitimately land — needs no special case.
 *
 * `git diff HEAD --numstat` and `git ls-files --others --exclude-standard`
 * both print paths relative to the VCS root, whatever `cwd` they are given —
 * so every path is normalised through `roots` before it is returned, rather
 * than left for each of this snapshot's six consumers to reinterpret on its
 * own. The result is workspace-relative for a path inside the workspace,
 * which is what makes the ordinary case — `roots.workspaceRoot ===
 * roots.vcsRoot` — read exactly as it did before this normalisation existed.
 * See specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md.
 */
export const snapshotTree = (roots: TRoots): TTreeSnapshot => {
  const tracked = gitOutput(['diff', 'HEAD', '--numstat'], roots.vcsRoot)
    .split('\n')
    .flatMap((line) => {
      const fields = line.split('\t')
      const path = fields.at(-1)?.trim() ?? ''
      return fields.length >= 3 && path
        ? [
            [
              normaliseFromGit(roots, path),
              `${fields[0]},${fields[1]}`,
            ] as const,
          ]
        : []
    })
  const untracked = gitOutput(
    ['ls-files', '--others', '--exclude-standard'],
    roots.vcsRoot,
  )
    .split('\n')
    .flatMap((line) =>
      line.trim()
        ? [[normaliseFromGit(roots, line.trim()), 'untracked'] as const]
        : [],
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
