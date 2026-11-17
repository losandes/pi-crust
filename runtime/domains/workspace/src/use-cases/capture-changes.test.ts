import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TRun } from '../../../../lib/contracts'
import { changeCapture } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  captureChanges,
  changesAsEnvelope,
  DIFF_FILENAME,
  resolveBase,
} from './capture-changes'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A repository with one tracked, committed file on `main`. */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-capture-changes-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'tracked.txt'), 'line one\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'first commit')
  return dir
}

/** Run `fn` with the process cwd pinned to `dir`, always restoring it. */
const inDir = <T>(dir: string, fn: () => T): T => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return fn()
  } finally {
    process.chdir(was)
  }
}

const runAt = (dir: string): TRun =>
  ({
    contextHandoffDir: dir,
  }) as unknown as TRun

test(
  [
    'given use-cases/capture-changes::resolveBase',
    'when run outside a git repository',
    'it should throw, naming the fix rather than failing on a git error',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-not-a-repo-'))

    // when, then
    inDir(dir, () =>
      expect(() => resolveBase('main')).toThrow(/not a git repository/),
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::resolveBase',
    'when the named ref does not exist in the repository',
    'it should throw and suggest a ref that does',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()

    // when, then
    inDir(dir, () =>
      expect(() => resolveBase('does-not-exist')).toThrow(
        /base ref 'does-not-exist' does not exist/,
      ),
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::resolveBase',
    'when HEAD has commits ahead of the base ref',
    'it should measure from the merge base and say HEAD is ahead',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    git(dir, 'checkout', '-qb', 'feature')
    writeFileSync(join(dir, 'tracked.txt'), 'line one\nline two\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'second commit')

    // when
    const actual = inDir(dir, () => resolveBase('main'))

    // then
    expect(actual.ref).toBe('main')
    expect(actual.reason).toMatch(/HEAD is ahead of main/)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::resolveBase',
    'when HEAD is on the base ref with uncommitted changes',
    'it should diff the working tree',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line one\nline two\n')

    // when
    const actual = inDir(dir, () => resolveBase('main'))

    // then
    expect(actual.reason).toMatch(/diffing the uncommitted working tree/)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::resolveBase',
    'when HEAD is on the base ref with a clean tree and a parent commit',
    'it should fall back to the last commit',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'other.txt'), 'another file\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'second commit')

    // when
    const actual = inDir(dir, () => resolveBase('main'))

    // then
    expect(actual.reason).toMatch(/falling back to the last commit/)
    expect(actual.commit).toBe(git(dir, 'rev-parse', 'HEAD~1'))
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::resolveBase',
    'when HEAD is on the base ref with a clean tree and no parent commit',
    'it should say so rather than claim a fallback it cannot take',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()

    // when
    const actual = inDir(dir, () => resolveBase('main'))

    // then
    expect(actual.reason).toMatch(/clean tree and no parent commit/)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::captureChanges',
    'when the working tree has a tracked edit and an untracked file',
    'it should persist the diff and report the facts captured',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line one\nline two\n')
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    const run = runAt(dir)

    // when
    const actual = inDir(dir, () =>
      captureChanges(run, changeCapture({ base: 'main' })),
    )

    // then
    expect(actual.files).toEqual(['tracked.txt'])
    expect(actual.untracked).toEqual(['new.txt'])
    expect(actual.insertions).toBeGreaterThan(0)
    expect(actual.truncated).toBe(false)
    const written = readFileSync(join(dir, DIFF_FILENAME), 'utf8')
    expect(written).toContain('## untracked files')
    expect(written).toContain('new.txt')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::captureChanges',
    'when nothing was marked for untracked inclusion',
    'it should report no untracked files and say so in the written diff',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    const run = runAt(dir)

    // when
    const actual = inDir(dir, () =>
      captureChanges(
        run,
        changeCapture({ base: 'main', includeUntracked: false }),
      ),
    )

    // then
    expect(actual.untracked).toEqual([])
    const written = readFileSync(join(dir, DIFF_FILENAME), 'utf8')
    expect(written).toContain('## untracked files\n  (none)')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::captureChanges',
    'when the diff is longer than maxDiffLines',
    'it should truncate the written diff and say how much was cut',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    writeFileSync(join(dir, 'tracked.txt'), `${long}\n`)
    const run = runAt(dir)

    // when
    const actual = inDir(dir, () =>
      captureChanges(run, changeCapture({ base: 'main', maxDiffLines: 2 })),
    )

    // then
    expect(actual.truncated).toBe(true)
    const written = readFileSync(join(dir, DIFF_FILENAME), 'utf8')
    expect(written).toContain('[truncated at 2 lines of')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::changesAsEnvelope',
    'when a captured change set is wrapped for an agent',
    'it should summarise the totals and carry the diff path forward',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line one\nline two\n')
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    const run = runAt(dir)
    const captured = inDir(dir, () =>
      captureChanges(run, changeCapture({ base: 'main' })),
    )

    // when
    const actual = changesAsEnvelope(captured, 'write it up')

    // then
    expect(actual.status).toBe('success')
    expect(actual.summary).toMatch(/^2 file\(s\) changed since main/)
    expect(actual.notes_for_next_agent).toBe('write it up')
    expect(actual.changed_files).toEqual(['tracked.txt', 'new.txt'])
    expect(actual.diff_path).toBe(captured.diffPath)
    expect(actual.artifacts).toEqual([captured.diffPath])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/capture-changes::changesAsEnvelope',
    'when no notes are given',
    'it should default notes_for_next_agent to the empty string',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line one\nline two\n')
    const run = runAt(dir)
    const captured = inDir(dir, () =>
      captureChanges(run, changeCapture({ base: 'main' })),
    )

    // when
    const actual = changesAsEnvelope(captured)

    // then
    expect(actual.notes_for_next_agent).toBe('')
  },
)
