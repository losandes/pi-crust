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

/** A commit that happened, and what went into it. `sha: ''` means it did not. */
export type TCommit = Readonly<{
  sha: string
  paths: readonly string[]
}>

/**
 * Stage exactly these paths and commit them.
 *
 * Returns the new short sha and the paths that went in, or an empty sha when
 * nothing of them was left to stage.
 *
 * `git add -A` is what this replaces, and the difference is the whole point:
 * `-A` stages the repository, so the first Activity declaring `commit: true`
 * swept up every unrelated file a developer had in progress, under a message
 * describing something else, attributed to a run that did not write it.
 * Nothing warned, and the only evidence was inside the commit.
 *
 * `--` separates the paths from anything git might read as a revision: a file
 * and a branch can share a name, and git resolves that in favour of the
 * revision. A path that no longer exists is staged as a deletion, which is
 * correct — an Activity that deleted a file it was permitted to delete did
 * that on purpose.
 *
 * An empty staged set is not an error. An Activity whose gates passed without
 * leaving anything behind has done its job.
 */
export const commitPaths = (
  message: string,
  paths: readonly string[],
): TCommit => {
  if (!isRepo()) {
    throw new Error(
      'not a git repository — a commit activityRun needs one. Run `git init` in the ' +
        'repo root (and make a first commit) before running a workflow that commits.',
    )
  }
  if (paths.length === 0) {
    return { sha: '', paths: [] }
  }
  git('add', '--', ...paths)
  // What the index actually holds, which is the record worth reporting: a
  // path the Activity rewrote back to its committed content stages nothing,
  // and a path it deleted stages a deletion.
  const staged = lines(git('diff', '--cached', '--name-only', '--', ...paths))
  if (staged.length === 0) {
    return { sha: '', paths: [] }
  }
  git('commit', '-m', message, '--', ...paths)

  return { sha: git('rev-parse', '--short', 'HEAD'), paths: staged }
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

/*
 * There is no `checkoutPath` here, and there must not be one.
 *
 * It discarded a tracked file's uncommitted changes when an agent was thought
 * to have written outside its allowlist. `git checkout --` has no undo: the
 * content was not in a commit, not in the index and not in a stash, so a
 * wrong guess about whose edit it was destroyed work with no way back. The
 * guess was wrong whenever a developer was typing in the same tree, which is
 * a supported way to use this tool.
 *
 * A developer can run `git checkout` themselves, knowing what they are
 * discarding. pi-crust cannot know, so pi-crust reports.
 */
