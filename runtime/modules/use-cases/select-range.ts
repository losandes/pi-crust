/**
 * `--base`: which change is being judged, and why those paths.
 *
 * `verify`, `review` and `code-review` read the uncommitted working tree by
 * default, which makes all three pre-commit instruments. A selector lets them
 * judge work that is already committed — a single ref, or a two-ended range —
 * without any of them growing its own notion of what "the change" is.
 *
 * Four cases, and the reason records which one git was in:
 *
 *   ''        the uncommitted working tree, exactly as before
 *   A...B     commits on B since it diverged from A
 *   A..B      every commit from A to B
 *   <ref>     `resolveBase`, which already decides between a branch point, an
 *             uncommitted tree, and a clean tree with a parent
 *
 * It throws rather than settles: every call site is inside an activity run body, where
 * a throw is the error boundary. An explicit spec selecting NO path throws too
 * — a range that matches nothing must not read as "nothing changed, nothing to
 * check", which is the silent green `routing.checks` already guards against.
 */

import * as gitData from '../data/git'
import type { TRangeSelection } from '../typedefs/changes'
import { isRange } from '../typedefs/changes'
import { resolveBase } from './capture-changes'

/** The git surface a selection needs. Injected so the cases are testable. */
export type TRangeGit = Readonly<{
  refExists: (ref: string) => boolean
  shortSha: (ref: string) => string
  changedFiles: () => readonly string[]
  untrackedFiles: () => readonly string[]
  diffFiles: (base: string) => readonly string[]
  diffFilesBetween: (
    from: string,
    to: string,
    symmetric: boolean,
  ) => readonly string[]
  mergeBase: (ref: string, other: string) => string
  filesUnder: (pathspec: string) => readonly string[]
  resolveBase: typeof resolveBase
}>

const defaultGit: TRangeGit = {
  refExists: gitData.refExists,
  shortSha: gitData.shortSha,
  changedFiles: gitData.changedFiles,
  untrackedFiles: gitData.untrackedFiles,
  diffFiles: gitData.diffFiles,
  diffFilesBetween: gitData.diffFilesBetween,
  mergeBase: gitData.mergeBase,
  filesUnder: gitData.filesUnder,
  resolveBase,
}

/**
 * Is this spec a place rather than a point in history?
 *
 * Deliberately syntactic: a separator, a glob character, or a suffix. Asking
 * the filesystem would make the answer depend on what happens to exist, and a
 * typo'd ref would silently become an empty path scope.
 */
const looksLikePath = (spec: string): boolean =>
  spec.includes('/') || spec.includes('*') || /\.[a-z0-9]+$/i.test(spec)

const sorted = (paths: readonly string[]): readonly string[] =>
  [...paths].filter(Boolean).toSorted()

/** Both endpoints must resolve, and the message says what to pass instead. */
const requireRef = (git: TRangeGit, ref: string, spec: string): string => {
  if (!git.refExists(ref)) {
    throw new Error(
      `base ref '${ref}' in '${spec}' does not exist in this repository — ` +
        'pass --base with a ref or range that does (e.g. --base HEAD~1, ' +
        '--base main...HEAD).',
    )
  }
  return ref
}

/** `A..B` / `A...B` split once, with git's own defaults for either end. */
const splitRange = (
  spec: string,
  symmetric: boolean,
): Readonly<{ from: string; to: string }> => {
  const separator = symmetric ? '...' : '..'
  const index = spec.indexOf(separator)
  const left = spec.slice(0, index)
  const right = spec.slice(index + separator.length)
  return { from: left || 'main', to: right || 'HEAD' }
}

export const selectRangeWith =
  (git: TRangeGit) =>
  (spec: string): TRangeSelection => {
    if (spec === '') {
      return {
        spec,
        from: '',
        to: '',
        paths: sorted([...git.changedFiles(), ...git.untrackedFiles()]),
        reason: 'no base given — the uncommitted working tree',
      }
    }

    if (isRange(spec)) {
      const symmetric = spec.includes('...')
      const { from, to } = splitRange(spec, symmetric)
      requireRef(git, from, spec)
      requireRef(git, to, spec)
      return {
        spec,
        from,
        to,
        paths: sorted(git.diffFilesBetween(from, to, symmetric)),
        reason: symmetric
          ? `commits on ${to} since it diverged from ${from} ` +
            `(${git.shortSha(git.mergeBase(from, to))})`
          : `every commit from ${from} to ${to}`,
      }
    }

    // A path scope: every file under it, whenever it was committed. This is
    // the case a range cannot express — reviewing a directory nobody touched
    // this week, or running the conventions over one package in a monorepo.
    //
    // A ref wins the ambiguity when a branch and a directory share a name,
    // because `--base main` meant a ref long before this existed and must not
    // change meaning now.
    if (!git.refExists(spec) && looksLikePath(spec)) {
      const paths = sorted(git.filesUnder(spec))
      return {
        spec,
        from: '',
        to: '',
        paths,
        reason: `every tracked file under '${spec}', whenever it was committed`,
      }
    }

    const base = git.resolveBase(spec)
    return {
      spec,
      from: base.commit,
      to: '',
      paths: sorted([...git.diffFiles(base.commit), ...git.untrackedFiles()]),
      reason: base.reason,
    }
  }

export const selectRange = selectRangeWith(defaultGit)

/**
 * The selection's paths, or a throw when an EXPLICIT spec selected none.
 *
 * An empty working tree is a legitimate answer; an empty range is not. A range
 * that matches nothing would otherwise read as "nothing changed, nothing to
 * check" and pass every check vacuously.
 */
export const requireSelected = (
  selection: TRangeSelection,
): readonly string[] => {
  if (selection.spec !== '' && selection.paths.length === 0) {
    throw new Error(
      `--base '${selection.spec}' selects no changed file ` +
        `(${selection.reason}) — there is nothing to judge. Widen it (e.g. ` +
        '--base main...HEAD) or drop it to read the working tree.',
    )
  }
  return selection.paths
}

export const selectedPathsWith =
  (git: TRangeGit) =>
  (spec: string): readonly string[] =>
    requireSelected(selectRangeWith(git)(spec))

/** The paths a spec names, or a throw when an explicit one names none. */
export const selectedPaths = selectedPathsWith(defaultGit)
