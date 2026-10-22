import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitPaths } from './git'

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

/** `commitPaths` shells out in the process's cwd, so the test stands there. */
const inRepo = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
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
    // which includes the now-removed path.
    const actual = inRepo(dir, () =>
      commitPaths('fix: drop the unwanted file', ['extra.test.ts']),
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
    const actual = inRepo(dir, () =>
      commitPaths('fix: drop the file removed without git', ['extra.test.ts']),
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
    const actual = inRepo(dir, () =>
      commitPaths('fix: add the new file', ['new-file.ts', 'nope.txt']),
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
    const actual = inRepo(dir, () =>
      commitPaths('fix: nothing to commit', ['nope.txt', 'also-nope.txt']),
    )

    // then — no commit was made, and HEAD did not move
    expect(actual).toEqual({ sha: '', paths: [] })
    expect(git(dir, 'rev-parse', 'HEAD')).toEqual(before)
  },
)
