import { expect, test } from 'bun:test'
import { removedSettingFaults } from './removed-settings'

for (const { document, location, replacement } of [
  {
    document: { routing: {} },
    location: 'routing',
    replacement:
      'the section was removed and tasks (`tasks:`) replace it; delete this key.',
  },
  {
    document: { routing: { checks: [] } },
    location: 'routing.checks',
    replacement:
      'tasks replace routing.checks. Declare each command under `tasks:` with `when: [{ on: change }]`, `match` and `run` (references/config.md, Tasks); delete this key.',
  },
  {
    document: { routing: { unmatched: 'warn' } },
    location: 'routing.unmatched',
    replacement:
      'tasks replace routing.checks, and the unmatched-path policy went with it: a run reports how many changed paths no task matched and never fails on it; delete this key.',
  },
  {
    document: { agents: [{ name: 'build', gates: ['checks'] }] },
    location: 'agents[build].gates',
    replacement:
      'the `checks` gate was removed. Repository commands are tasks (`tasks:`) that fire at `change` after any Activity; delete this key.',
  },
  ...['activities', 'agents'].map((section) => ({
    document: { [section]: [{ name: 'build', gates: [] }] },
    location: `${section}[build].gates`,
    replacement:
      'per-Activity gate lists were removed. Output checks now follow from what the Activity reports (its `output`); delete this key.',
  })),
]) {
  test(
    [
      `given a removed setting at ${location}`,
      'when inspecting a parsed layer',
      'it should name its file, entry and replacement even for empty lists',
    ].join(', '),
    () => {
      // given
      const layers = [{ file: 'config.yaml', document }]
      // when
      const actual = removedSettingFaults(layers)
      // then
      expect(actual).toEqual([`config.yaml: ${location} — ${replacement}`])
    },
  )
}

test(
  [
    'given clean and malformed documents without removed settings',
    'when inspecting all layers',
    'it should return no faults',
  ].join(', '),
  () => {
    // given
    const layers = [
      undefined,
      42,
      {
        activities: [{ name: 'build' }],
      },
    ].map((document) => ({ file: 'config.yaml', document }))
    // when
    const actual = removedSettingFaults(layers)
    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given multiple settings in multiple layers',
    'when inspecting them',
    'it should retain layer order and document order',
  ].join(', '),
  () => {
    // given
    const layers = [
      {
        file: 'one',
        document: {
          agents: [{ gates: [] }],
          routing: { skills: [], checks: [] },
        },
      },
      { file: 'two', document: { activities: [{ name: 'build', gates: [] }] } },
    ]
    // when
    const actual = removedSettingFaults(layers).map(
      (line) => line.split(' — ')[0],
    )
    // then
    expect(actual).toEqual([
      'one: agents[0].gates',
      'one: routing.skills',
      'one: routing.checks',
      'two: activities[build].gates',
    ])
  },
)
