import { expect, test } from 'bun:test'
import {
  activityConfigSchema,
  activitySuccession,
  plannerConfigSchema,
  terminalConfigSchema,
} from './activity'

const PROMPTS = '.'

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
