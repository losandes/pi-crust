import { expect, test } from 'bun:test'
import { assembleConfig } from './assemble-config'
import { aLayer } from './config-layer-fixture.test'

for (const [activities, expected] of [
  [{ bad: { prompts: { system: 'old.md' } } }, 'activities.bad.prompts'],
  [{ bad: false }, 'activities.bad'],
  [[], 'activities'],
] as const) {
  test(
    [
      `given malformed entries at ${expected}`,
      'when assembling configuration',
      'it should report the table and entry name instead of an array index',
    ].join(', '),
    () => {
      // given
      const layers = [aLayer('repository', { activities })]
      // when
      const actual = () => assembleConfig(layers)
      // then
      expect(actual).toThrow(expected)
    },
  )
}

for (const prompts of [undefined, 'shared', '/absolute/prompts']) {
  test(
    [
      `given an entry with prompts ${prompts}`,
      'when a later layer tunes the entry',
      'it should retain the first declaring root and replace lifecycle stages',
    ].join(', '),
    () => {
      // given
      const layers = [
        aLayer('package', {
          activities: {
            build: { ...(prompts === undefined ? {} : { prompts }) },
          },
          lifecycles: {
            ship: { stages: [{ name: 'old', serial: ['build'] }] },
          },
        }),
        aLayer('machine', {
          activities: { build: { model: 'machine' }, new: {} },
          lifecycles: {
            ship: { stages: [{ name: 'new', concurrent: ['build'] }] },
          },
        }),
      ]
      // when
      const actual = assembleConfig(layers)
      // then
      expect(actual.faults).toEqual([])
      expect(actual.document.activities).toEqual([
        {
          name: 'build',
          model: 'machine',
          prompts: prompts?.startsWith('/')
            ? prompts
            : `/package/${prompts ?? 'prompts/build'}`,
        },
        { name: 'new', prompts: '/machine/prompts/new' },
      ])
      expect(actual.document.lifecycles).toEqual([
        {
          name: 'ship',
          stages: [
            { name: 'new', strategy: 'concurrent', activities: ['build'] },
          ],
        },
      ])
    },
  )
}

test(
  [
    'given a lifecycle with invalid stages',
    'when assembled',
    'it should return stage faults without converting invalid stages',
  ].join(', '),
  () => {
    // given
    // when
    const actual = assembleConfig([
      aLayer('repository', {
        lifecycles: { bad: { stages: [{}] } },
        db: 'history.db',
        ports: { backend: 4700 },
      }),
    ])
    // then
    expect(actual.faults.length).toBeGreaterThan(0)
    expect(actual.document.lifecycles).toEqual([])
    expect(actual.document.observability).toEqual({
      db: 'history.db',
      ports: { backend: 4700 },
    })
  },
)

test(
  [
    'given an empty document',
    'when assembled',
    'it should produce empty registries and observability',
  ].join(', '),
  () => {
    // given
    // when
    const actual = assembleConfig([])
    // then
    expect(actual.document).toMatchObject({
      agents: [],
      activities: [],
      planners: [],
      terminal: [],
      lifecycles: [],
      observability: {},
    })
  },
)
