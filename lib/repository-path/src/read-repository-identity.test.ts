import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SKIP_INTEGRATION } from '../../../runtime/testing/integration'
import {
  readRepositoryIdentity,
  repositoryPathAt,
} from './read-repository-identity'

for (const repository of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      'given a scratch directory',
      `when reading identity with repository=${repository}`,
      'it should tolerate absent origin and missing cwd',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'repository-identity-'))
      try {
        if (repository) expect(spawnSync('git', ['init', root]).status).toBe(0)
        // when
        const identity = readRepositoryIdentity(root)
        const missing = readRepositoryIdentity(join(root, 'missing'))
        const invalid = readRepositoryIdentity(`${root}\0`)
        // then
        expect(identity).toEqual({
          originUrl: undefined,
          primaryClone: realpathSync(root),
        })
        expect(missing).toEqual({
          originUrl: undefined,
          primaryClone: resolve(root, 'missing'),
        })
        expect(invalid).toEqual({
          originUrl: undefined,
          primaryClone: `${root}\0`,
        })
        expect(repositoryPathAt(root)[0]).toBe('local')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
test.skipIf(SKIP_INTEGRATION)(
  [
    'given a fork and linked worktree reached through a symlink',
    'when reading both identities',
    'it should use only origin and the same real primary clone',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'repository-worktree-'))
    const primary = join(root, 'primary')
    const linked = join(root, 'linked')
    const alias = join(root, 'alias')
    const git = (...args: string[]) =>
      expect(spawnSync('git', ['-C', primary, ...args]).status).toBe(0)
    try {
      mkdirSync(primary)
      git('init')
      git(
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      )
      git('remote', 'add', 'origin', 'git@github.com:someone/pi-crust.git')
      git('remote', 'add', 'upstream', 'git@github.com:losandes/pi-crust.git')
      git('worktree', 'add', '-b', 'linked', linked)
      symlinkSync(primary, alias)
      // when
      const identity = readRepositoryIdentity(alias)
      // then
      expect(identity).toEqual(readRepositoryIdentity(linked))
      expect(identity).toEqual({
        originUrl: 'git@github.com:someone/pi-crust.git',
        primaryClone: realpathSync(primary),
      })
      expect(repositoryPathAt(linked)).toEqual(['someone', 'pi-crust'])
      git('remote', 'remove', 'origin')
      expect(repositoryPathAt(alias)).toEqual(repositoryPathAt(linked))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
