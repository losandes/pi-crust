import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitPaths, commitsAhead, pushBranch, remoteExists, upstreamBase } from './git'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

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

test(
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

test(
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
    expect(
      git(dir, 'diff', '--name-status', 'HEAD~1', 'HEAD'),
    ).toEqual('D\textra.test.ts')
  },
)

test(
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
    expect(
      git(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD'),
    ).toEqual('new-file.ts')
  },
)

test(
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

test(
  [
    'given data/git::commitPaths',
    'when a touched path is addressed by its ABSOLUTE spelling, above the directory commitPaths is given as cwd',
    'it should still stage and commit it — an absolute pathspec resolves inside the repository regardless of cwd',
  ].join(', '),
  () => {
    /*
     * given — the nested-workspace shape this fix exists for: a file that
     * lives above the directory commitPaths is addressed from. `cwd` here
     * stands in for a WORKSPACE nested inside a larger VCS root; the touched
     * path is spelled absolute, the way deliver.ts resolves a touched path
     * before handing it to commitPaths. See
     * specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md — 1.4.1.
     */
    const dir = aRepo()
    writeFileSync(join(dir, 'above-workspace.txt'), 'written above the workspace\n')

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

test(
  [
    'given data/git::remoteExists',
    'when the remote was registered',
    'it should say so',
  ].join(', '),
  () => {
    // given
    const { dir } = aRepoWithRemote()

    // when / then
    expect(remoteExists('origin', dir)).toBe(true)
    expect(remoteExists('upstream', dir)).toBe(false)
  },
)

test(
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

test(
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

test(
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

test(
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

test(
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
    const onRemote = execFileSync(
      'git',
      ['branch', '--list', 'feature'],
      { cwd: bare, encoding: 'utf8' },
    )
    expect(onRemote).toContain('feature')
  },
)
