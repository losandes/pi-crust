import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ABSENT, snapshotContent } from './content-snapshot'
import type { TRoots } from './roots'

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-content-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'tracked'), 'before\n')
  writeFileSync(join(dir, '.gitignore'), 'ignored\n')
  git('add', '.')
  git('commit', '-qm', 'initial')
  const base = git('rev-parse', 'HEAD')
  const roots: TRoots = { workspaceRoot: dir, vcsRoot: dir }
  return {
    dir,
    git,
    base,
    roots,
    [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex')

const cases = [
  {
    name: 'a tracked file modified and uncommitted',
    prepare: (f: ReturnType<typeof fixture>) =>
      writeFileSync(join(f.dir, 'tracked'), 'after\n'),
    expected: { tracked: digest('after\n') },
  },
  {
    name: 'a change committed after base',
    prepare: (f: ReturnType<typeof fixture>) => {
      writeFileSync(join(f.dir, 'tracked'), 'after\n')
      f.git('commit', '-qam', 'edit')
    },
    expected: { tracked: digest('after\n') },
  },
  {
    name: 'an untracked file',
    prepare: (f: ReturnType<typeof fixture>) =>
      writeFileSync(join(f.dir, 'new file\nname'), 'new'),
    expected: { 'new file\nname': digest('new') },
  },
  {
    name: 'an ignored file',
    prepare: (f: ReturnType<typeof fixture>) =>
      writeFileSync(join(f.dir, 'ignored'), 'private'),
    expected: {},
  },
  {
    name: 'a tracked file deleted',
    prepare: (f: ReturnType<typeof fixture>) => rmSync(join(f.dir, 'tracked')),
    expected: { tracked: ABSENT },
  },
  {
    name: 'a rename',
    prepare: (f: ReturnType<typeof fixture>) => {
      renameSync(join(f.dir, 'tracked'), join(f.dir, 'renamed'))
      f.git('add', '-A')
    },
    expected: { tracked: ABSENT, renamed: digest('before\n') },
  },
]

for (const entry of cases) {
  test(
    [
      `given ${entry.name}`,
      'when content is snapshotted against the start commit',
      'it should return exactly the changed content',
    ].join(', '),
    () => {
      // given
      using f = fixture()
      entry.prepare(f)
      // when
      const actual = snapshotContent(f.roots, f.base)
      // then
      expect(actual).toEqual({ status: 'ok', data: entry.expected })
    },
  )
}

test(
  [
    'given a base that does not resolve',
    'when content is snapshotted',
    'it should settle as an error',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    // when
    const actual = snapshotContent(f.roots, 'missing')
    // then
    expect(actual.status).toBe('error')
  },
)

test(
  [
    'given a workspace nested below the VCS root',
    'when inside and outside paths change',
    'it should normalise inside paths and retain absolute outside paths',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    const workspaceRoot = join(f.dir, 'package')
    mkdirSync(workspaceRoot)
    writeFileSync(join(workspaceRoot, 'inside'), 'inside')
    writeFileSync(join(f.dir, 'tracked'), 'outside')
    // when
    const actual = snapshotContent({ ...f.roots, workspaceRoot }, f.base)
    // then
    expect(actual).toEqual({
      status: 'ok',
      data: {
        inside: digest('inside'),
        [join(f.dir, 'tracked')]: digest('outside'),
      },
    })
  },
)

test(
  [
    'given unchanged content',
    'when read twice',
    'it should yield the same digest',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    writeFileSync(join(f.dir, 'tracked'), 'after')
    // when
    const first = snapshotContent(f.roots, f.base)
    const second = snapshotContent(f.roots, f.base)
    // then
    expect(second).toEqual(first)
  },
)

test(
  [
    'given a previously snapshotted file',
    'when its bytes change without changing its line counts',
    'it should yield a different digest',
  ].join(', '),
  () => {
    // given
    using f = fixture()
    writeFileSync(join(f.dir, 'tracked'), 'one')
    const first = snapshotContent(f.roots, f.base)
    // when
    writeFileSync(join(f.dir, 'tracked'), 'two')
    const second = snapshotContent(f.roots, f.base)
    // then
    expect(second).not.toEqual(first)
  },
)
