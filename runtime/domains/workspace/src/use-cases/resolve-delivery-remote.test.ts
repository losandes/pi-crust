import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  deliveryRemoteFrom,
  resolveDeliveryRemote,
} from './resolve-delivery-remote'

for (const [configured, pushDefault, remotes, expected] of [
  ['configured', 'push', ['only'], 'configured'],
  [undefined, 'push', ['one', 'two'], 'push'],
  [undefined, '', ['upstream'], 'upstream'],
  [undefined, '', ['one', 'two'], 'origin'],
  [undefined, '', [], 'origin'],
] as const) {
  test(
    [
      `given @SC17 remote candidates ${configured}, ${pushDefault}, ${remotes.join(',')}`,
      'when delivery selects a remote',
      `it should choose ${expected}`,
    ].join(', '),
    () => {
      // given
      // when
      const actual = deliveryRemoteFrom({ configured, pushDefault, remotes })
      // then
      expect(actual).toBe(expected)
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a disposable repository with a sole remote and then a push default',
    'when delivery reads Git candidates',
    'it should discover them without writing or contacting a remote',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-delivery-remote-'))
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    try {
      git('init', '-q')
      git('remote', 'add', 'upstream', join(root, 'unused.git'))
      // when
      const sole = resolveDeliveryRemote(undefined, root)
      git('config', 'remote.pushDefault', 'push-target')
      const preferred = resolveDeliveryRemote(undefined, root)
      const explicit = resolveDeliveryRemote('configured', root)
      // then
      expect(sole).toBe('upstream')
      expect(preferred).toBe('push-target')
      expect(explicit).toBe('configured')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
