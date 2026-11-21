import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activityConfigSchema,
  activitySuccession,
  plannerConfigSchema,
  terminalConfigSchema,
} from './activity'

const PROMPTS = { system: 's.md', user: 'u.md' }

const cases: readonly Readonly<{
  name: string
  output: string
  succession?: 'supersedes' | 'annotates'
  expected: 'supersedes' | 'annotates'
}>[] = [
  { name: 'a custom reviewer', output: 'reviewOutput', expected: 'annotates' },
  { name: 'code-review', output: 'buildOutput', expected: 'supersedes' },
  { name: 'a planner', output: 'planOutput', expected: 'supersedes' },
  {
    name: 'an ordinary Activity',
    output: 'genericOutput',
    expected: 'supersedes',
  },
  {
    name: 'an issue reporter',
    output: 'ghIssueOutput',
    succession: 'annotates',
    expected: 'annotates',
  },
  {
    name: 'a superseding reviewer',
    output: 'reviewOutput',
    succession: 'supersedes',
    expected: 'supersedes',
  },
]

for (const given of cases) {
  test(
    [
      'given contracts/activity::activitySuccession',
      `when the loaded registry declares ${given.name}`,
      `it should resolve succession to ${given.expected} from the entry, not its name`,
    ].join(', '),
    () => {
      // given
      const config = activityConfigSchema.parse({
        ...given,
        prompts: PROMPTS,
      })

      // when
      const actual = activitySuccession([config], given.name)

      // then
      expect(actual).toBe(given.expected)
      expect(config.succession).toBe(given.succession)
    },
  )
}

test(
  [
    'given contracts/activity::activityConfigSchema',
    'when an Activity declares an unknown succession policy',
    'it should reject it rather than silently defaulting',
  ].join(', '),
  () => {
    // given
    const given = {
      name: 'custom',
      prompts: PROMPTS,
      succession: 'sometimes',
    }

    // when
    const actual = activityConfigSchema.safeParse(given)

    // then
    expect(actual.success).toBe(false)
  },
)

for (const schema of [plannerConfigSchema, terminalConfigSchema]) {
  test(
    [
      'given an engine-controlled entry schema',
      `when ${schema === plannerConfigSchema ? 'a Planner' : 'a terminal Activity'} is given succession`,
      'it should not expose a succession property',
    ].join(', '),
    () => {
      // given
      const given = {
        name: 'engine-entry',
        prompts: PROMPTS,
        succession: 'annotates',
      }

      // when
      const actual = schema.parse(given)

      // then
      expect('succession' in actual).toBe(false)
    },
  )
}

test(
  [
    'given the shipped Activity registry',
    'when its declarations and output-derived defaults are resolved',
    'it should preserve succession on every ordinary Activity and no engine-controlled entry',
  ].join(', '),
  () => {
    // given
    const path = join(
      import.meta.dir,
      '../../../../templates/stamp/config/crust.activities.yaml',
    )
    const given = Bun.YAML.parse(readFileSync(path, 'utf8')) as Record<
      string,
      readonly Record<string, unknown>[]
    >

    // when
    const activities = given.activities ?? []
    const engineEntries = [...(given.planners ?? []), ...(given.terminal ?? [])]

    // then
    expect(activities.length).toBeGreaterThan(0)
    expect(engineEntries.length).toBeGreaterThan(0)
    expect(
      activities.map((entry) => ({
        name: entry.name,
        succession: activitySuccession(
          activities.map((one) => activityConfigSchema.parse(one)),
          String(entry.name),
        ),
      })),
    ).toEqual(
      activities.map((entry) => ({
        name: entry.name,
        succession:
          entry.output === 'reviewOutput' || entry.name === 'gh-issue'
            ? 'annotates'
            : 'supersedes',
      })),
    )
    expect(engineEntries.some((entry) => 'succession' in entry)).toBe(false)
  },
)
