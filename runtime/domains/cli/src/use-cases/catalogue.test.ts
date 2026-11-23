import { expect, test } from 'bun:test'
import { layersFixture } from '../../../../testing/config-layers'
import {
  EMPTY_REPOSITORY_PATH,
  withShippedPackage,
} from '../../../../testing/shipped-layer'
import type { TCatalogue } from './catalogue'
import { catalogueOf, renderCatalogue } from './catalogue'

const SHIPPED_CONFIG = EMPTY_REPOSITORY_PATH

test(
  [
    'given @SC11 a package Planner and a later machine Planner',
    'when listing the merged catalogue',
    'it should preserve the loader order instead of reordering the closed set',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'package/crust.activities.toml':
        '[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n',
      'machine/crust.activities.toml': '[planners.operator]\nwrites = []\n',
    })
    // when
    const actual = catalogueOf(f.repositoryPath, f.env)
    // then
    expect(actual.planners.map((entry) => entry.name)).toEqual([
      'triage',
      'operator',
    ])
  },
)

test(
  [
    'given catalogue::catalogueOf',
    'when read against the shipped config',
    'it should list gh-pull-request under terminal',
  ].join(', '),
  () => {
    // given
    // when
    const actual = withShippedPackage(() => catalogueOf(SHIPPED_CONFIG))

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

test(
  [
    'given @SC5 @SC14 a machine-only lifecycle and an Activity missing prompts',
    'when listing a repository catalogue',
    'it should list the lifecycle without validating unused prompts',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'machine/crust.lifecycles.toml':
        '[lifecycles.machine-only]\nstages = [{ name = "work", serial = ["spike"] }]\n',
      'machine/crust.activities.toml':
        '[activities.spike]\nwrites = []\nprompts = "missing"\n',
    })
    // when
    const actual = catalogueOf(f.repositoryPath, f.env)
    // then
    expect(actual.lifecycles.map((entry) => entry.name)).toContain(
      'machine-only',
    )
    expect(actual.activities.map((entry) => entry.name)).toContain('spike')
  },
)
