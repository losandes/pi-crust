/**
 * Where paths come from, and what each is relative to.
 *
 *   workspaceRoot  the directory holding .pi-crust/ — agents' cwd, and the
 *                  base for everything configuration names
 *   vcsRoot        git rev-parse --show-toplevel — the base for everything
 *                  git prints, whatever cwd git was given
 *
 * They are equal in the ordinary case. They differ when a workspace is one
 * package of a monorepo, which is a supported layout: the workspace is where
 * that package's conventions, skills and prompts live, and it is not where
 * git counts from.
 *
 * See specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md.
 */

import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileExists } from '../../../../lib/system'
export type TRoots = Readonly<{ workspaceRoot: string; vcsRoot: string }>

/** A path as git printed it, made absolute before anything else sees it. */
export const fromGit = (roots: TRoots, printed: string): string =>
  resolve(roots.vcsRoot, printed)

/**
 * The single spelling every boundary converges on: relative to the
 * workspace when the path is inside it, absolute otherwise.
 *
 * Absolute is correct for a path outside the workspace, because no
 * workspace-relative pattern — `writes`, `protected_files` — could have
 * meant a file somewhere else, and an ambiguous relative spelling is exactly
 * what let a VCS-root-relative string be misread as workspace-relative.
 */
export const relativeToWorkspace = (
  workspaceRoot: string,
  absolute: string,
): string => {
  const within = relative(resolve(workspaceRoot), absolute)

  return within === '' || within.startsWith('..') ? absolute : within
}

/** A path as git printed it, normalised to the one spelling every consumer shares. */
export const normaliseFromGit = (roots: TRoots, printed: string): string =>
  relativeToWorkspace(roots.workspaceRoot, fromGit(roots, printed))

/** A claim an agent wrote, resolved workspace-first and then repository-wide. */
export const resolveClaim = (
  roots: TRoots,
  claim: string,
): Readonly<{ path: string; root: 'workspace' | 'vcs' }> | undefined => {
  if (isAbsolute(claim)) {
    return fileExists(claim) ? { path: claim, root: 'vcs' } : undefined
  }
  const inWorkspace = join(roots.workspaceRoot, claim)
  if (fileExists(inWorkspace)) return { path: inWorkspace, root: 'workspace' }
  const inRepository = join(roots.vcsRoot, claim)

  return fileExists(inRepository)
    ? { path: inRepository, root: 'vcs' }
    : undefined
}
