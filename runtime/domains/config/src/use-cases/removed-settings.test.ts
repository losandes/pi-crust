import { expect, test } from 'bun:test'
import { removedSettingFaults } from './removed-settings'

for (const { document, location, replacement } of [
  {
    document: { routing: { skills: [] } },
    location: 'routing.skills',
    replacement:
      'skill routing was removed. A skill belongs where the coding agent discovers skills; delete this key.',
  },
  {
    document: { routing: { checks: [{ name: 'lint', operation: 'lint' }] } },
    location: 'routing.checks[lint].operation',
    replacement:
      'labels on repository commands were removed and nothing replaced them; delete this key.',
  },
  {
    document: { routing: { checks: [{ area: 'backend' }] } },
    location: 'routing.checks[0].area',
    replacement:
      'labels on repository commands were removed and nothing replaced them; delete this key.',
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
        routing: { checks: [{ name: 'lint', argv: ['true'] }] },
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
          routing: { skills: [], checks: [{ area: '', operation: '' }] },
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
      'one: routing.checks[0].area',
      'one: routing.checks[0].operation',
      'two: activities[build].gates',
    ])
  },
)
