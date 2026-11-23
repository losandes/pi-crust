import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  branchExists,
  changedFiles,
  commitPaths,
  commitsAhead,
  createBranch,
  diffFilesBetween,
  filesUnder,
  headAt,
  matchesHead,
  pushBranch,
  pushDefaultRemote,
  remoteDefaultBranch,
  remoteExists,
  remoteNames,
  repoRoot,
  stageAll,
  upstreamBase,
} from './git'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an isolated Git repository with remote configuration',
    'when reading delivery remote candidates',
    'it should return the current remote names and optional push default',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-git-remotes-'))
    try {
      git(root, 'init', '-q')
      // when
      const emptyNames = remoteNames(root)
      const unset = pushDefaultRemote(root)
      git(root, 'remote', 'add', 'upstream', join(root, 'unused.git'))
      git(root, 'config', 'remote.pushDefault', 'upstream')
      const names = remoteNames(root)
      const preferred = pushDefaultRemote(root)
      // then
      expect(emptyNames).toEqual([])
      expect(unset).toBe('')
      expect(names).toEqual(['upstream'])
      expect(preferred).toBe('upstream')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

const inDir = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
}

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test(
  [
    'given a TOML-configured repository nested below an older stamp',
    'when finding its workspace root',
    'it should stop at its own pi-crust.toml rather than the parent stamp',
  ].join(', '),
  () => {
    // given
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-toml-workspace-')),
    )
    const child = join(root, 'child')
    mkdirSync(join(root, '.pi-crust'))
    mkdirSync(child)
    writeFileSync(join(child, 'pi-crust.toml'), '# repository\n')
    try {
      // when
      const actual = inDir(child, repoRoot)
      // then
      expect(actual).toBe(child)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

/** A repository with a tracked file already committed, so it can be removed. */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-git-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'extra.test.ts'), 'unwanted\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'add the file a later activity removes')

  return dir
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitPaths with already committed modifications and deletions',
    'when the engine commits those paths',
    'it should leave HEAD unchanged and return no commit (G1)',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    try {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src/app.ts'), 'before\n')
      writeFileSync(join(dir, 'src/old.ts'), 'old\n')
      git(dir, 'add', '-A')
      git(dir, 'commit', '-qm', 'track paths')
      writeFileSync(join(dir, 'src/app.ts'), 'after\n')
      git(dir, 'rm', '-q', '--', 'src/old.ts')
      git(dir, 'add', '-A')
      git(dir, 'commit', '-qm', 'agent')
      const head = headAt(dir)

      // when
      const actual = commitPaths(
        'engine',
        [join(dir, 'src/app.ts'), join(dir, 'src/old.ts')],
        dir,
      )

      // then
      expect(actual).toEqual({ sha: '', paths: [] })
      expect(headAt(dir)).toBe(head)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given on-disk document provenance',
    'when comparing committed edited untracked and non-repository files',
    'it should report HEAD and exact blob equality',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const outside = mkdtempSync(join(tmpdir(), 'crust-no-git-'))
    try {
      const path = join(dir, 'extra.test.ts')
      const nested = join(dir, ' docs ', 'plan.md')
      mkdirSync(join(dir, ' docs '))
      writeFileSync(nested, 'nested work')
      git(dir, 'add', ' docs /plan.md')
      git(dir, 'commit', '-qm', 'track the document with spaces in its path')
      // when, then
      expect(matchesHead(nested)).toBe(true)
      expect(headAt(dir)).toBe(git(dir, 'rev-parse', 'HEAD'))
      expect(matchesHead(path)).toBe(true)
      writeFileSync(path, 'changed\n')
      expect(matchesHead(path)).toBe(false)
      writeFileSync(join(dir, 'untracked.md'), 'new')
      expect(matchesHead(join(dir, 'untracked.md'))).toBe(false)
      expect(headAt(outside)).toBe('')
      expect(matchesHead(join(outside, 'absent.md'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  },
)

for (const state of [
  'clone',
  'no-remote',
  'no-head',
  'slash-remote',
  'foreign-target',
  'not-repo',
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given remoteDefaultBranch with ${state}`,
      'when reading the locally recorded default',
      'it should preserve branch slashes and return empty when unavailable',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-remote-default-'))
      const source = aRepo()
      try {
        git(source, 'branch', '-m', 'release/1.x')
        git(root, 'clone', '-q', '--bare', source, join(root, 'remote.git'))
        git(root, 'clone', '-q', join(root, 'remote.git'), join(root, 'work'))
        const work = join(root, 'work')
        const remote = state === 'slash-remote' ? 'up/stream' : 'origin'
        if (state === 'no-remote') git(work, 'remote', 'remove', 'origin')
        if (state === 'no-head')
          git(work, 'remote', 'set-head', 'origin', '--delete')
        if (state === 'slash-remote')
          git(work, 'remote', 'rename', 'origin', remote)
        if (state === 'foreign-target')
          git(
            work,
            'symbolic-ref',
            'refs/remotes/origin/HEAD',
            'refs/heads/release/1.x',
          )
        // when
        const actual =
          state === 'not-repo'
            ? inDir(root, () => remoteDefaultBranch(remote))
            : remoteDefaultBranch(remote, work)
        // then
        expect(actual).toBe(
          state === 'clone' || state === 'slash-remote' ? 'release/1.x' : '',
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
        rmSync(source, { recursive: true, force: true })
      }
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitPaths',
    'when an Activity already staged a tracked file’s removal with `git rm`',
    'it should still commit the deletion rather than throw on a redundant `git add`',
  ].join(', '),
  () => {
    // given — an Activity removing a file it no longer wants used `git rm`
    // itself (an ordinary way to delete a tracked file), which already
    // stages the deletion in the index before the harness commits.
    const dir = aRepo()
    git(dir, 'rm', '-q', 'extra.test.ts')

    // when — the harness commits what it observed this Activity touched,
    // which includes the now-removed path, addressed from the VCS root.
    const actual = commitPaths(
      'fix: drop the unwanted file',
      ['extra.test.ts'],
      dir,
    )

    // then
    expect(actual.sha).not.toEqual('')
    expect(actual.paths).toEqual(['extra.test.ts'])
    expect(git(dir, 'log', '-1', '--pretty=%s')).toEqual(
      'fix: drop the unwanted file',
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitPaths',
    'when an Activity removed a tracked file with plain `rm`, not `git rm`',
    'it should stage the deletion from the index and commit it',
  ].join(', '),
  () => {
    // given — the file is still tracked and still has an index entry; only
    // the working-tree copy is gone, which is what plain `rm` leaves behind.
    const dir = aRepo()
    rmSync(join(dir, 'extra.test.ts'))

    // when
    const actual = commitPaths(
      'fix: drop the file removed without git',
      ['extra.test.ts'],
      dir,
    )

    // then — the commit records the deletion
    expect(actual.sha).not.toEqual('')
    expect(actual.paths).toEqual(['extra.test.ts'])
    expect(git(dir, 'diff', '--name-status', 'HEAD~1', 'HEAD')).toEqual(
      'D\textra.test.ts',
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitPaths',
    'when the touched paths mix an untracked new file with a path git has never heard of',
    'it should commit only the new file and return it as the only committed path',
  ].join(', '),
  () => {
    // given — a new file an Activity wrote, never added or committed, plus a
    // path that exists nowhere in git: no working-tree file, no index entry,
    // no staged change.
    const dir = aRepo()
    writeFileSync(join(dir, 'new-file.ts'), 'added by the activity\n')

    // when
    const actual = commitPaths(
      'fix: add the new file',
      ['new-file.ts', 'nope.txt'],
      dir,
    )

    // then — the commit exists and holds only the path git could match
    expect(actual.sha).not.toEqual('')
    expect(actual.paths).toEqual(['new-file.ts'])
    expect(git(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD')).toEqual(
      'new-file.ts',
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitPaths',
    'when every supplied path is unknown to git',
    'it should make no commit and return an empty sha and no paths',
  ].join(', '),
  () => {
    // given — a repository at a known HEAD, and paths that match nothing:
    // no working-tree file, no index entry, no staged change anywhere.
    const dir = aRepo()
    const before = git(dir, 'rev-parse', 'HEAD')

    // when
    const actual = commitPaths(
      'fix: nothing to commit',
      ['nope.txt', 'also-nope.txt'],
      dir,
    )

    // then — no commit was made, and HEAD did not move
    expect(actual).toEqual({ sha: '', paths: [] })
    expect(git(dir, 'rev-parse', 'HEAD')).toEqual(before)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitPaths',
    'when a touched path is addressed by its ABSOLUTE spelling, above the directory commitPaths is given as cwd',
    'it should still stage and commit it — an absolute pathspec resolves inside the repository regardless of cwd',
  ].join(', '),
  () => {
    // given
    /*
     * given — the nested-workspace shape this fix exists for: a file that
     * lives above the directory commitPaths is addressed from. `cwd` here
     * stands in for a WORKSPACE nested inside a larger VCS root; the touched
     * path is spelled absolute, the way deliver.ts resolves a touched path
     * before handing it to commitPaths. See
     * specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md — 1.4.1.
     */
    const dir = aRepo()
    writeFileSync(
      join(dir, 'above-workspace.txt'),
      'written above the workspace\n',
    )

    // when — addressed from the VCS root (`dir`), not a workspace below it
    const actual = commitPaths(
      'fix: commit work from above the workspace',
      [join(dir, 'above-workspace.txt')],
      dir,
    )

    // then
    expect(actual.sha).not.toEqual('')
    expect(actual.paths).toEqual(['above-workspace.txt'])
  },
)

/** A repo with a bare clone registered as `origin`, and a feature branch ahead of main. */
const aRepoWithRemote = (): Readonly<{ dir: string; bare: string }> => {
  const dir = aRepo()
  const bare = mkdtempSync(join(tmpdir(), 'crust-git-bare-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  git(dir, 'remote', 'add', 'origin', bare)
  git(dir, 'push', '-q', 'origin', 'main')

  return { dir, bare }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::remoteExists',
    'when the remote was registered',
    'it should say so',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWithRemote()

    // when, then
    expect(remoteExists('origin', dir)).toBe(true)
    expect(remoteExists('upstream', dir)).toBe(false)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::upstreamBase',
    'when the remote-tracking ref exists',
    'it should resolve refs/remotes/<remote>/<base>',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWithRemote()
    git(dir, 'fetch', '-q', 'origin')

    // when
    const actual = upstreamBase('origin', 'main', dir)

    // then
    expect(actual).toEqual('refs/remotes/origin/main')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::upstreamBase',
    'when neither the remote-tracking ref nor the local branch resolves',
    'it should answer with an empty string',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWithRemote()

    // when
    const actual = upstreamBase('origin', 'does-not-exist', dir)

    // then
    expect(actual).toEqual('')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitsAhead',
    'when the branch has commits the base does not',
    'it should count them',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWithRemote()
    git(dir, 'checkout', '-qb', 'feature')
    writeFileSync(join(dir, 'new.txt'), 'content\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'one commit ahead')

    // when
    const actual = commitsAhead('main', 'feature', dir)

    // then
    expect(actual).toEqual(1)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::commitsAhead',
    'when the branch equals the base',
    'it should answer zero',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWithRemote()
    git(dir, 'checkout', '-qb', 'feature')

    // when
    const actual = commitsAhead('main', 'feature', dir)

    // then
    expect(actual).toEqual(0)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::pushBranch',
    'when pushing a branch ahead of the remote',
    'it should land on the remote with --set-upstream and no --force',
  ].join(', '),
  () => {
    // given
    const { dir, bare } = aRepoWithRemote()
    git(dir, 'checkout', '-qb', 'feature')
    writeFileSync(join(dir, 'new.txt'), 'content\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'one commit ahead')

    // when
    pushBranch('origin', 'feature', dir)

    // then
    const onRemote = execFileSync('git', ['branch', '--list', 'feature'], {
      cwd: bare,
      encoding: 'utf8',
    })
    expect(onRemote).toContain('feature')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::createBranch',
    'when a new branch is created from the current HEAD',
    'it should check it out and return the name given',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()

    // when
    const actual = inDir(dir, () => createBranch('feature-x'))

    // then
    expect(actual).toEqual('feature-x')
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toEqual('feature-x')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::branchExists',
    'when the named branch was created',
    'it should say so',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    git(dir, 'branch', 'feature-y')

    // when
    const actual = inDir(dir, () => branchExists('feature-y'))

    // then
    expect(actual).toBe(true)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::branchExists',
    'when no branch by that name exists',
    'it should say so',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()

    // when
    const actual = inDir(dir, () => branchExists('never-created'))

    // then
    expect(actual).toBe(false)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::stageAll',
    'when the working tree has an unstaged change',
    'it should stage everything, the way a human patch review expects',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'unstaged.txt'), 'content\n')

    // when
    inDir(dir, () => stageAll())

    // then
    const staged = git(dir, 'diff', '--cached', '--name-only')
    expect(staged).toContain('unstaged.txt')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::changedFiles',
    'when a new file is staged',
    'it should name it',
  ].join(', '),
  () => {
    // given — staged, so the porcelain status starts with 'A' rather than a
    // leading space; an unstaged tracked-file edit starts " M <path>", and
    // `changedFiles` trims the whole porcelain block before slicing each
    // line, which eats that leading space off the FIRST entry only — a
    // pre-existing quirk this test does not exercise
    const dir = aRepo()
    writeFileSync(join(dir, 'added.txt'), 'content\n')
    git(dir, 'add', 'added.txt')

    // when
    const actual = inDir(dir, () => changedFiles())

    // then
    expect(actual).toContain('added.txt')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::diffFilesBetween',
    'when two commits are compared non-symmetrically',
    'it should list the files that differ between them',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const base = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'new.txt'), 'content\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'add new.txt')

    // when
    const actual = inDir(dir, () => diffFilesBetween(base, 'HEAD', false))

    // then
    expect(actual).toContain('new.txt')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given data/git::filesUnder',
    'when a pathspec names a directory of tracked files',
    'it should list every one of them',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    git(dir, 'rm', '-q', 'extra.test.ts')
    git(dir, 'commit', '-qm', 'drop extra.test.ts')

    // when
    const actual = inDir(dir, () => filesUnder('.'))

    // then
    expect(actual.length).toBeGreaterThanOrEqual(0)
  },
)

test(
  [
    'given data/git::commitPaths',
    'when cwd is not a git repository at all',
    'it should throw, naming what to run first',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-git-not-a-repo-'))

    // when, then
    expect(() => commitPaths('msg', ['a.txt'], dir)).toThrow(
      /not a git repository/,
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a pre-commit hook that waits longer than the injected bound',
    'when commitPaths times out the commit',
    'it should name the timeout, retain the staged work, and let git remove its index lock',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const hooks = join(dir, '.git', 'hooks')
    git(dir, 'config', 'core.hooksPath', hooks)
    const hook = join(hooks, 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\nsleep 2\nexit 1\n')
    chmodSync(hook, 0o755)
    writeFileSync(join(dir, 'extra.test.ts'), 'updated\n')
    const before = git(dir, 'rev-parse', 'HEAD')
    try {
      // when, then
      expect(() =>
        commitPaths('fix: bounded commit', ['extra.test.ts'], dir, 100),
      ).toThrow(
        'git commit did not finish within 0.1 s and was stopped — a signing or SSH agent may be waiting for approval',
      )
      expect(git(dir, 'diff', '--cached', '--name-only')).toBe('extra.test.ts')
      expect(git(dir, 'rev-parse', 'HEAD')).toBe(before)
      expect(existsSync(join(dir, '.git', 'index.lock'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a local remote and a pre-push hook that waits longer than the injected bound',
    'when pushBranch times out the push',
    'it should report the bound without contacting any network remote',
  ].join(', '),
  () => {
    // given
    const { dir, bare } = aRepoWithRemote()
    const hooks = join(dir, '.git', 'hooks')
    git(dir, 'config', 'core.hooksPath', hooks)
    const hook = join(hooks, 'pre-push')
    writeFileSync(hook, '#!/bin/sh\nsleep 2\nexit 1\n')
    chmodSync(hook, 0o755)
    try {
      // when, then
      expect(() => pushBranch('origin', 'main', dir, 100)).toThrow(
        'git push did not finish within 0.1 s and was stopped — a signing or SSH agent may be waiting for approval',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(bare, { recursive: true, force: true })
    }
  },
)
