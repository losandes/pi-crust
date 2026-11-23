import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../../../lib/contracts'
import { layersFixture } from '../../../../testing/config-layers'
import { loadConfig } from '../../../config'
import { plannedNames } from '../..'
import { plannedActivities } from './planned-activities'

const cfg = crustConfigSchema.parse({
  activities: ['identify', 'conceptualize', 'plan', 'test', 'build'].map(
    (name) => ({ name, purpose: name, prompts: '.' }),
  ),
  lifecycles: [
    {
      name: 'sdlc',
      stages: [
        { name: 'discover', activities: ['identify', 'conceptualize'] },
        { name: 'implement', activities: ['build'] },
      ],
    },
    { name: 'empty', stages: [] },
  ],
})

for (const [lifecycle, activities, expected] of [
  ['sdlc', undefined, ['identify', 'conceptualize', 'build']],
  [undefined, 'plan,test,build', ['plan', 'test', 'build']],
] as const) {
  test(
    [
      `given lifecycle ${lifecycle} and chain ${activities}`,
      'when planned',
      'it should preserve Stage and Activity order',
    ].join(', '),
    () => {
      // given
      // when
      const actual = plannedActivities({ lifecycle, activities }, cfg)
      // then
      expect(plannedNames(actual)).toEqual([...expected])
      expect(actual.every((stage) => stage.strategy === 'serial')).toBe(true)
    },
  )
}

for (const [lifecycle, activities, message] of [
  ['sdlc', 'plan', 'not both'],
  ['missing', undefined, 'sdlc'],
  ['empty', undefined, 'no activities'],
  [undefined, 'plan,operator', 'operator cannot be named in a chain'],
  [undefined, 'plan,deploy', 'unknown activity(s): deploy'],
  [undefined, undefined, '--lifecycle'],
] as const) {
  test(
    [
      `given invalid lifecycle ${lifecycle} and chain ${activities}`,
      'when planned',
      `it should refuse with ${message}`,
    ].join(', '),
    () => {
      // given
      // when
      const actual = () => plannedActivities({ lifecycle, activities }, cfg)
      // then
      expect(actual).toThrow(message)
    },
  )
}

test(
  [
    'given @SC5 a machine-only lifecycle',
    'when planning it from another repository',
    'it should expose its loaded stages',
  ].join(', '),
  () => {
    // given
    using f = layersFixture({
      'machine/crust.lifecycles.toml':
        '[lifecycles.machine-only]\nstages = [{ name = "work", serial = ["build"] }]\n',
      'package/crust.activities.toml':
        '[activities.build]\nwrites = []\n[planners.operator]\nwrites = []\n[planners.triage]\nwrites = []\n[terminal.gh-pull-request]\nwrites = []\n',
    })
    const config = loadConfig(f.repositoryPath, f.env)
    // when
    const actual = plannedActivities(
      { lifecycle: 'machine-only', activities: undefined },
      config,
    )
    // then
    expect(actual).toEqual([
      { name: 'work', strategy: 'serial', activities: ['build'] },
    ])
  },
)
