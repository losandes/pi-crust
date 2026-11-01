import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { catalogueOf } from './catalogue'

/*
 * Absolute, from import.meta.dir — the same way shipped-config.test.ts's
 * STAMP constant is built. A path relative to the PROCESS cwd broke this
 * test the moment it ran as part of a repository-wide `bun test` from the
 * repo root rather than scoped to runtime/, where cwd is runtime/ itself.
 */
const SHIPPED_CONFIG = join(
  import.meta.dir,
  '..',
  'templates',
  'stamp',
  'config',
  'crust.config.yaml',
)

test(
  [
    'given catalogue::catalogueOf',
    'when read against the shipped config',
    'it should list gh-pull-request under terminal',
  ].join(', '),
  () => {
    // given / when
    const actual = catalogueOf(SHIPPED_CONFIG)

    // then
    expect(actual.terminal.map((entry) => entry.name)).toEqual([
      'gh-pull-request',
    ])
    expect(actual.terminal[0]?.detail).not.toEqual('')
  },
)
