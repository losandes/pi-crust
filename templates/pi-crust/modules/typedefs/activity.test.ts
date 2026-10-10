import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activitiesFileSchema,
  activityConfigSchema,
  activityNamed,
  mergeActivities,
  offerable,
} from './activity'
import { crustConfigSchema } from './config'

/**
 * The roster this refactor has to carry forward without losing anything.
 *
 * Reading the shipped config rather than a fixture is deliberate: a fixture
 * would keep passing after somebody added a key to the real roster that the
 * Activity schema cannot express, which is the exact regression this stage
 * exists to prevent.
 */
const shippedAgents = () => {
  const path = join(import.meta.dir, '..', '..', 'config', 'crust.config.yaml')
  return crustConfigSchema.parse(Bun.YAML.parse(readFileSync(path, 'utf8')))
    .agents
}

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when every agent in the shipped roster is parsed as an Activity',
    'it should accept all of them unchanged',
  ].join(', '),
  () => {
    // given
    const given = shippedAgents()

    // when
    const actual = given.map((agent) => activityConfigSchema.safeParse(agent))

    // then
    expect(given.length).toBeGreaterThan(0)
    expect(actual.filter((one) => !one.success)).toEqual([])
  },
)

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
      prompt_engineering: { system: 's.md', user: 'u.md' },
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
    'given typedefs/activity::offerable',
    'when some Activities are hidden',
    'it should keep the declared order and drop only the hidden ones',
  ].join(', '),
  () => {
    // given — order is presentation, and the file is the only place it lives
    const prompts = { system: 's.md', user: 'u.md' }
    const given = [
      { name: 'plan', prompt_engineering: prompts },
      { name: 'security-research', prompt_engineering: prompts, hidden: true },
      { name: 'build', prompt_engineering: prompts },
    ].map((one) => activityConfigSchema.parse(one))

    // when
    const actual = offerable(given).map((one) => one.name)

    // then
    expect(actual).toEqual(['plan', 'build'])
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
        prompt_engineering: { system: 's.md', user: 'u.md' },
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
    'given typedefs/activity::activitiesFileSchema',
    'when the file is empty',
    'it should parse to no Activities rather than failing',
  ].join(', '),
  () => {
    // given — a team that has removed every Activity has said something valid
    const given = {}

    // when
    const actual = activitiesFileSchema.parse(given)

    // then
    expect(actual.activities).toEqual([])
  },
)

test(
  [
    'given typedefs/activity::mergeActivities',
    'when a local layer sets two keys on an Activity the team declared',
    'it should keep every key the local layer did not mention',
  ].join(', '),
  () => {
    // given
    const base = [
      {
        name: 'planner',
        model: 'fireworks/kimi-k3',
        thinking: 'high',
        color: 'violet',
        purpose: 'Turn a request into a plan.',
        prompt_engineering: {
          system: 'planner/system.md',
          user: 'planner/user.md',
        },
        writes: ['specs/'],
        tools: ['read', 'write'],
      },
    ]
    const local = [{ name: 'planner', thinking: 'medium', color: 'blue' }]

    // when
    const actual = mergeActivities(base, local)

    // then
    expect(actual).toEqual([
      {
        name: 'planner',
        model: 'fireworks/kimi-k3',
        thinking: 'medium',
        color: 'blue',
        purpose: 'Turn a request into a plan.',
        prompt_engineering: {
          system: 'planner/system.md',
          user: 'planner/user.md',
        },
        writes: ['specs/'],
        tools: ['read', 'write'],
      },
    ])
  },
)

test(
  [
    'given typedefs/activity::mergeActivities',
    'when a local layer declares an Activity the team file does not have',
    'it should be added rather than refused',
  ].join(', '),
  () => {
    // given — the developer's machine, the developer's checkout, their call
    const base = [{ name: 'planner' }]
    const local = [{ name: 'spike', writes: ['/'], tools: ['bash'] }]

    // when
    const actual = mergeActivities(base, local).map((one) => one.name)

    // then
    expect(actual).toEqual(['planner', 'spike'])
  },
)

test(
  [
    'given typedefs/activity::mergeActivities',
    'when a local layer overrides one prompt',
    'it should keep the other rather than dropping it with the object',
  ].join(', '),
  () => {
    // given
    const base = [
      { name: 'planner', prompt_engineering: { system: 's.md', user: 'u.md' } },
    ]
    const local = [
      { name: 'planner', prompt_engineering: { system: 'mine.md' } },
    ]

    // when
    const actual = mergeActivities(base, local)

    // then
    expect(actual[0]?.prompt_engineering).toEqual({
      system: 'mine.md',
      user: 'u.md',
    })
  },
)

test(
  [
    'given typedefs/activity::mergeActivities',
    'when a local layer overrides a list',
    'it should replace it, so a tool can be removed and not only added',
  ].join(', '),
  () => {
    // given
    const base = [{ name: 'planner', tools: ['read', 'write', 'bash'] }]
    const local = [{ name: 'planner', tools: ['read'] }]

    // when
    const actual = mergeActivities(base, local)

    // then
    expect(actual[0]?.tools).toEqual(['read'])
  },
)

test(
  [
    'given typedefs/activity::mergeActivities',
    'when an overridden Activity sits between two others',
    'it should hold its place, because order is what menus display',
  ].join(', '),
  () => {
    // given
    const base = [{ name: 'plan' }, { name: 'build' }, { name: 'verify' }]
    const local = [{ name: 'build', model: 'local-model' }]

    // when
    const actual = mergeActivities(base, local).map((one) => one.name)

    // then
    expect(actual).toEqual(['plan', 'build', 'verify'])
  },
)
