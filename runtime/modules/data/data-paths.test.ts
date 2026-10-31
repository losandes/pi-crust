import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  primaryWorktree,
  resolveConfiguredPath,
  resolveDataPaths,
} from './data-paths'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-data-paths-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'tester@example.com')
  git(dir, 'config', 'user.name', 'tester')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'f.txt'), 'x\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

test(
  [
    'given data/data-paths::resolveConfiguredPath',
    'when the value is already absolute',
    'it should return it unchanged',
  ].join(', '),
  () => {
    // given
    const value = '/var/data/crust'

    // when
    const actual = resolveConfiguredPath(value, '/some/repo')

    // then
    expect(actual).toEqual('/var/data/crust')
  },
)

test(
  [
    'given data/data-paths::resolveConfiguredPath',
    'when the value is relative',
    'it should resolve against the repository root, not process.cwd()',
  ].join(', '),
  () => {
    // given
    const value = '.pi-crust/data'
    const repoRoot = '/some/repo'

    // when
    const actual = resolveConfiguredPath(value, repoRoot)

    // then
    expect(actual).toEqual('/some/repo/.pi-crust/data')
  },
)

test(
  [
    'given data/data-paths::resolveConfiguredPath',
    'when the value starts with ~',
    'it should expand to the user\'s home directory',
  ].join(', '),
  () => {
    // given
    const value = '~/pi-crust-data'

    // when
    const actual = resolveConfiguredPath(value, '/some/repo')

    // then
    expect(actual).toEqual(join(homedir(), 'pi-crust-data'))
  },
)

test(
  [
    'given data/data-paths::primaryWorktree',
    'when the tree is not a git repository',
    'it should fall back to the repository root',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-data-paths-nogit-'))

    // when
    const actual = primaryWorktree(dir)

    // then
    expect(actual).toEqual(dir)
  },
)

test(
  [
    'given data/data-paths::primaryWorktree',
    'when run inside the main clone itself',
    'it should answer the clone',
  ].join(', '),
  () => {
    // given
    const dir = aRepo()

    // when
    const actual = primaryWorktree(dir)

    // then
    expect(actual).toEqual(resolve(dir))
  },
)

test(
  [
    'given data/data-paths::primaryWorktree',
    'when run inside a linked worktree',
    'it should answer the primary clone it was branched from',
  ].join(', '),
  () => {
    // given
    const primary = aRepo()
    const linked = mkdtempSync(join(tmpdir(), 'crust-data-paths-linked-'))
    git(primary, 'worktree', 'add', '-q', '--force', linked, '-b', 'feature')

    // when
    const actual = primaryWorktree(linked)

    // then
    expect(actual).toEqual(realpathSync(resolve(primary)))
  },
)

test(
  [
    'given data/data-paths::resolveConfiguredPath',
    'when the value contains {primary_worktree} and the tree is a linked worktree',
    'it should expand the token to the primary clone',
  ].join(', '),
  () => {
    // given
    const primary = aRepo()
    const linked = mkdtempSync(join(tmpdir(), 'crust-data-paths-linked-'))
    git(primary, 'worktree', 'add', '-q', '--force', linked, '-b', 'feature2')

    // when
    const actual = resolveConfiguredPath('{primary_worktree}/.pi-crust/data', linked)

    // then
    expect(actual).toEqual(join(realpathSync(resolve(primary)), '.pi-crust', 'data'))
  },
)

test(
  [
    'given data/data-paths::primaryWorktree',
    'when the tree is a bare clone',
    'it should fail loudly naming the path it expanded to rather than write beside the bare repository',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-data-paths-bare-'))
    const bare = join(root, 'repo.git')
    mkdirSync(bare)
    git(bare, 'init', '-q', '--bare', '-b', 'main')

    // when / then
    expect(() => primaryWorktree(bare)).toThrow(/bare/i)
  },
)

test(
  [
    'given data/data-paths::resolveDataPaths',
    'when CRUST_DATA_DIR is set',
    'it should override defaults.data_dir before resolution',
  ].join(', '),
  () => {
    // given
    const cfg = {
      defaults: { data_dir: '.pi-crust/data' },
      observability: { db: '.pi-crust/data/crust.db' },
    }
    const env = { CRUST_DATA_DIR: '/override/data' }

    // when
    const actual = resolveDataPaths(cfg, '/some/repo', env)

    // then
    expect(actual).toEqual({
      dataDir: '/override/data',
      db: '/some/repo/.pi-crust/data/crust.db',
    })
  },
)

test(
  [
    'given data/data-paths::resolveDataPaths',
    'when CRUST_DATA_DIR is only whitespace',
    'it should read as unset and resolve the configured value instead',
  ].join(', '),
  () => {
    // given
    const cfg = {
      defaults: { data_dir: '.pi-crust/data' },
      observability: { db: '.pi-crust/data/crust.db' },
    }
    const env = { CRUST_DATA_DIR: '   ' }

    // when
    const actual = resolveDataPaths(cfg, '/some/repo', env)

    // then
    expect(actual.dataDir).toEqual('/some/repo/.pi-crust/data')
  },
)
