import { expect, test } from 'bun:test'
import { removedSettingFaults } from './removed-settings'

for (const [document, location, replacement] of [
  [{ routing: {} }, 'routing', '[tasks.<name>]'],
  [{ routing: { checks: [] } }, 'routing.checks', 'when = [{ on = "change" }]'],
  [
    { routing: { unmatched: 'warn' } },
    'routing.unmatched',
    'never fails on it',
  ],
  [{ routing: { skills: [] } }, 'routing.skills', 'skill routing was removed'],
  [{ routing: { unknown: true } }, 'routing', 'section was removed'],
  [{ override: {} }, 'override', 'top level of the same file'],
  [
    { activities: { build: { gates: ['checks'] } } },
    'activities.build.gates',
    '[tasks.<name>]',
  ],
  ...['activities', 'planners', 'terminal'].map((section) => [
    { [section]: { build: { gates: [] } } },
    `${section}.build.gates`,
    'per-Activity gate lists were removed',
  ]),
] as const) {
  test(
    [
      `given a removed setting at ${location}`,
      'when inspecting a parsed TOML layer',
      'it should name the file and setting and explain the replacement',
    ].join(', '),
    () => {
      // given
      const layers = [{ file: 'config.toml', document }]
      // when
      const actual = removedSettingFaults(layers)
      // then
      expect(
        actual.some(
          (line) =>
            line.startsWith(`config.toml: ${location} — `) &&
            line.includes(String(replacement)),
        ),
      ).toBe(true)
      expect(actual.join('\n')).not.toContain('`tasks:`')
    },
  )
}

test(
  [
    'given clean and malformed documents without removed settings',
    'when inspecting layers',
    'it should return no faults',
  ].join(', '),
  () => {
    // given
    const layers = [
      undefined,
      42,
      { activities: { build: {} } },
      { planners: { operator: false } },
    ].map((document) => ({ file: 'config.toml', document }))
    // when
    const actual = removedSettingFaults(layers)
    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given removed settings in several layers',
    'when inspected',
    'it should retain file and declaration order',
  ].join(', '),
  () => {
    // given
    const layers = [
      {
        file: 'one',
        document: {
          activities: { build: { gates: [] } },
          routing: { skills: [], checks: [] },
        },
      },
      {
        file: 'two',
        document: { terminal: { 'gh-pull-request': { gates: [] } } },
      },
    ]
    // when
    const actual = removedSettingFaults(layers).map(
      (line) => line.split(' — ')[0],
    )
    // then
    expect(actual).toEqual([
      'one: activities.build.gates',
      'one: routing.skills',
      'one: routing.checks',
      'two: terminal.gh-pull-request.gates',
    ])
  },
)
