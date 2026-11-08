import { expect, test } from 'bun:test'
import { join } from 'node:path'
import type { TCatalogue } from './catalogue'
import { catalogueOf, renderCatalogue } from './catalogue'

/*
 * Absolute, from import.meta.dir — the same way shipped-config.test.ts's
 * STAMP constant is built. A path relative to the PROCESS cwd broke this
 * test the moment it ran as part of a repository-wide `bun test` from the
 * repo root rather than scoped to runtime/, where cwd is runtime/ itself.
 */
const SHIPPED_CONFIG = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
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

test(
  [
    'given catalogue::renderCatalogue',
    'when a catalogue has entries in every section',
    'it should print each section with its own how-to line',
  ].join(', '),
  () => {
    // given
    const catalogue: TCatalogue = {
      lifecycles: [{ name: 'sdlc', detail: 'the standard chain' }],
      planners: [{ name: 'triage', detail: 'it recommends a chain and stops' }],
      activities: [
        { name: 'build', detail: 'write the code' },
        { name: 'secret', detail: 'internal (hidden from menus)' },
      ],
      terminal: [{ name: 'gh-pull-request', detail: 'opens the PR' }],
    }

    // when
    const actual = renderCatalogue(catalogue)

    // then
    expect(actual).toContain('lifecycles')
    expect(actual).toContain('sdlc')
    expect(actual).toContain('planners')
    expect(actual).toContain('triage')
    expect(actual).toContain('activities')
    expect(actual).toContain('build')
    expect(actual).toContain('terminal')
    expect(actual).toContain('gh-pull-request')
  },
)

test(
  [
    'given catalogue::renderCatalogue',
    'when a section has no entries at all',
    'it should print (none) rather than an empty section',
  ].join(', '),
  () => {
    // given
    const catalogue: TCatalogue = {
      lifecycles: [],
      planners: [],
      activities: [],
      terminal: [],
    }

    // when
    const actual = renderCatalogue(catalogue)

    // then
    expect(actual).toContain('(none)')
  },
)
