import { expect, test } from 'bun:test'
import {
  activityConfigSchema,
  activityNamed,
  DEFAULT_ATTEMPTS,
  PLANNER_NAMES,
  plannerConfigSchema,
  plannerFaults,
  terminalConfigSchema,
  terminalFaults,
} from './activity'
import { agentConfigSchema, configDefaultsSchema } from './config'

for (const { name, schema } of [
  { name: 'activity', schema: activityConfigSchema },
  { name: 'Planner', schema: plannerConfigSchema },
  { name: 'terminal', schema: terminalConfigSchema },
  { name: 'agent', schema: agentConfigSchema },
  { name: 'defaults', schema: configDefaultsSchema },
]) {
  test(
    [
      `given #112 requirement 1.2.8, the ${name} config schema`,
      'when a file contains a provider-specific thinking level outside the CLI list',
      'it should preserve that string rather than restrict config to CLI thinking levels',
    ].join(', '),
    () => {
      // given
      const entry = {
        name: 'build',
        thinking: 'provider-adaptive',
        prompts: '.',
        writes: [],
      }

      // when
      const actual = schema.parse(entry)

      // then
      expect(actual.thinking).toBe('provider-adaptive')
    },
  )
}

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when an Activity does not say whether it is hidden',
    'it should be offered, because registering one should need no second edit',
  ].join(', '),
  () => {
    // given
    const given = {
      name: 'planner',
      prompts: '.',
    }

    // when
    const actual = activityConfigSchema.parse(given)

    // then
    expect(actual.hidden).toBe(false)
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when an Activity has no prompts',
    'it should be rejected rather than defaulted to a prompt that does not exist',
  ].join(', '),
  () => {
    // given
    const given = { name: 'planner' }

    // when
    const actual = activityConfigSchema.safeParse(given)

    // then
    expect(actual.success).toBe(false)
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when an entry declares no aliases',
    'it should default to an empty list',
  ].join(', '),
  () => {
    // given
    const given = {
      name: 'build',
      prompts: '.',
    }

    // when
    const actual = activityConfigSchema.parse(given)

    // then
    expect(actual.aliases).toEqual([])
  },
)

test(
  [
    'given typedefs/activity::plannerConfigSchema',
    'when an entry carries aliases',
    'it should parse with no aliases key, because a Planner may not be aliased',
  ].join(', '),
  () => {
    // given
    const given = {
      name: 'operator',
      prompts: '.',
      aliases: ['op'],
    }

    // when
    const actual = plannerConfigSchema.parse(given)

    // then
    expect('aliases' in actual).toBe(false)
  },
)

test(
  [
    'given typedefs/activity::activityNamed',
    'when a hidden Activity is asked for by name',
    'it should be found, because hiding is a preference and not a permission',
  ].join(', '),
  () => {
    // given
    const given = [
      activityConfigSchema.parse({
        name: 'security-research',
        prompts: '.',
        hidden: true,
      }),
    ]

    // when
    const actual = activityNamed(given, 'security-research')

    // then
    expect(actual?.name).toBe('security-research')
  },
)

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when an entry says nothing about the work half',
    'it should default to two attempts, no commit and the generic envelope',
  ].join(', '),
  () => {
    // given
    /*
     * Two, including the first, because the failure modes a budget
     * governs are correlated: one bad input expresses itself as a gate
     * failure, then a revision, then a regression.
     */
    const given = {
      name: 'spike',
      prompts: '.',
    }

    // when
    const actual = activityConfigSchema.parse(given)

    // then
    expect(actual.attempts).toEqual(DEFAULT_ATTEMPTS)
    expect(actual.attempts).toEqual(2)
    expect(actual.commit).toEqual(false)
    expect(actual.output).toEqual('genericOutput')
    expect(actual.input).toEqual('upstream')
  },
)

test(
  [
    'given typedefs/activity::plannerFaults',
    'when the Planners are exactly the set the engine knows',
    'it should find nothing wrong, which is what lets a team tune them',
  ].join(', '),
  () => {
    // given
    const given = [{ name: 'operator' }, { name: 'triage' }]

    // when
    const actual = plannerFaults(given)

    // then
    expect(actual).toEqual([])
    expect(PLANNER_NAMES).toEqual(['operator', 'triage'])
  },
)

test(
  [
    'given typedefs/activity::terminalFaults',
    'when a terminal Activity has no entry at all',
    'it should refuse, because configuration cannot remove one',
  ].join(', '),
  () => {
    // given
    const given: readonly Readonly<{ name: string }>[] = []

    // when
    const actual = terminalFaults(given)

    // then
    expect(actual.join('\n')).toMatch(
      /terminal Activity 'gh-pull-request' has no \[terminal\.gh-pull-request\] table/,
    )
  },
)

test(
  [
    'given typedefs/activity::terminalFaults',
    'when something under terminal: is not a terminal Activity',
    'it should refuse, because configuration cannot add one',
  ].join(', '),
  () => {
    // given
    const given = [{ name: 'gh-pull-request' }, { name: 'gh-merge-request' }]

    // when
    const actual = terminalFaults(given)

    // then
    expect(actual.join('\n')).toMatch(
      /'gh-merge-request' is under \[terminal\.gh-merge-request\] and is not a terminal Activity/,
    )
  },
)
