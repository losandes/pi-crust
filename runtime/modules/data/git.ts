/**
 * Low-level git operations for code activityRuns.
 *
 * Every invocation is an argv list, never a shell string — no quoting bugs, no
 * shell injection.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const run = (
  args: readonly string[],
  cwd?: string,
): Readonly<{ status: number; stdout: string; stderr: string }> => {
  const result = spawnSync('git', [...args], {
    encoding: 'utf8',
    ...(cwd === undefined ? {} : { cwd }),
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Run git, or throw. Used where a failure means the activityRun cannot continue. */
const git = (...args: readonly string[]): string => {
  const result = run(args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

/** Run git, keeping the output only when it succeeded. Never throws. */
export const gitOutput = (args: readonly string[], cwd?: string): string => {
  const result = run(args, cwd)
  return result.status === 0 ? result.stdout : ''
}

const lines = (text: string): readonly string[] =>
  text.split('\n').filter((line) => line.length > 0)

export const currentBranch = (): string =>
  git('rev-parse', '--abbrev-ref', 'HEAD')

export const createBranch = (name: string): string => {
  git('checkout', '-b', name)
  return name
}

export const isRepo = (): boolean =>
  run(['rev-parse', '--git-dir']).status === 0

/**
 * Absolute root of the WORKSPACE — where agents are spawned to work.
 *
 * The directory holding `.pi-crust/`, found by walking up from the process cwd.
 * NOT the git toplevel, which was the original implementation and is wrong
 * wherever a workspace is nested inside a larger repository: given a workspace
 * at `<repo>/workspace/`, the git root is `<repo>`, so every agent is spawned
 * one level too high and every path in the config — prompts, extensions,
 * skills — resolves against a directory that does not contain them.
 *
 * That failure is silent until something actually reads a path. Observed as
 * `Failed to load extension "<repo>/.pi-crust/..."` for a file that exists at
 * `<repo>/workspace/.pi-crust/...`.
 *
 * Falls back to the process cwd when no `.pi-crust/` is above it, so the modules
 * stay usable in tests and in a tree that has not been stamped.
 */
export const repoRoot = (): string => {
  const start = resolve(process.cwd())
  const walk = (dir: string): string | undefined => {
    if (existsSync(join(dir, '.pi-crust'))) {
      return dir
    }
    const parent = dirname(dir)
    return parent === dir ? undefined : walk(parent)
  }
  return walk(start) ?? start
}

/** Stage the working tree and commit it. Returns the new short sha. */
export const commitAll = (message: string): string => {
  if (!isRepo()) {
    throw new Error(
      'not a git repository — a commit activityRun needs one. Run `git init` in the ' +
        'repo root (and make a first commit) before running a workflow that commits.',
    )
  }
  git('add', '-A')
  if (!git('status', '--porcelain')) {
    throw new Error('nothing to commit — the preceding activityRuns changed no files')
  }
  git('commit', '-m', message)
  return git('rev-parse', '--short', 'HEAD')
}

/**
 * Stage everything and write a patch of it, signing nothing.
 *
 * `format-patch` needs a commit, so this stages, writes a tree, and builds a
 * commit object with `commit-tree` — none of which touch the signing path.
 * The index is left staged, because the point is to hand a human something
 * they can inspect, sign, and land themselves.
 */
export const stageAll = (): void => {
  git('add', '-A')
}

/** The staged diff, as a patch a human can read or `git apply`. */
export const stagedPatch = (): string => gitOutput(['diff', '--cached'])

/** Does this branch name already exist? */
export const branchExists = (name: string): boolean =>
  spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
    .status === 0

export const changedFiles = (): readonly string[] =>
  lines(git('status', '--porcelain')).map((line) => line.slice(3))

// ── diff plumbing (composed into a TChangeSet by capture-changes.ts) ─────────

/** True when `ref` resolves to a commit. Never throws — this is a question. */
export const refExists = (ref: string): boolean =>
  run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0

export const rev = (ref = 'HEAD'): string => git('rev-parse', ref)

export const shortSha = (ref = 'HEAD'): string =>
  git('rev-parse', '--short', ref)

/**
 * The commit where `ref` and `other` diverged — the honest base of a branch.
 *
 * On the base branch itself this returns HEAD, which makes the diff exactly
 * "what is not committed yet". Off it, the diff is the whole branch plus the
 * working tree. One command covers both cases, so no workflow has to branch on it.
 */
export const mergeBase = (ref: string, other = 'HEAD'): string =>
  git('merge-base', ref, other)

export const isDirty = (): boolean => git('status', '--porcelain').length > 0

/**
 * Untracked paths, spelled from the REPOSITORY ROOT.
 *
 * `git status --porcelain` always prints repo-root-relative paths; `ls-files`
 * prints them relative to the working directory. Mixing the two produces one
 * list with two different roots — which looks like duplicates, and silently
 * breaks any glob or command that is given it. Running from the root settles
 * it, and matters wherever `.pi-crust/` is not itself at the git root.
 */
export const untrackedFiles = (): readonly string[] =>
  lines(
    gitOutput(['ls-files', '--others', '--exclude-standard'], repoRoot()),
  )

/** Tracked files that differ between `base` and the working tree. */
export const diffFiles = (base: string): readonly string[] =>
  lines(git('diff', '--name-only', base))

/** Tracked files that differ between two commits. `symmetric` uses `a...b`. */
export const diffFilesBetween = (
  from: string,
  to: string,
  symmetric: boolean,
): readonly string[] =>
  lines(git('diff', '--name-only', `${from}${symmetric ? '...' : '..'}${to}`))

/**
 * Every tracked file under a pathspec — a directory, a glob, a single file.
 *
 * `--` separates it from anything git might read as a revision, which matters
 * because a directory and a branch can share a name, and git resolves the
 * ambiguity in favour of the revision.
 */
export const filesUnder = (pathspec: string): readonly string[] =>
  git('ls-files', '--', pathspec)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

export const diffStat = (base: string): string => git('diff', '--stat', base)

/** Insertions and deletions across the diff. Binary files count as neither. */
export const diffCounts = (
  base: string,
): Readonly<{ insertions: number; deletions: number }> =>
  lines(git('diff', '--numstat', base)).reduce(
    (totals, line) => {
      const [added = '', removed = ''] = line.split('\t')
      return {
        insertions:
          totals.insertions + (/^\d+$/.test(added) ? Number(added) : 0),
        deletions:
          totals.deletions + (/^\d+$/.test(removed) ? Number(removed) : 0),
      }
    },
    { insertions: 0, deletions: 0 },
  )

export const diffText = (base: string): string => git('diff', base)

/** Discard a tracked file's uncommitted changes. Returns true on success. */
export const checkoutPath = (path: string, cwd: string): boolean =>
  run(['checkout', '--', path], cwd).status === 0
