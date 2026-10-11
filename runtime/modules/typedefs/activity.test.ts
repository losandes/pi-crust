import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activitiesFileSchema,
  activityConfigSchema,
  activityNamed,
  activityPatchFileSchema,
  mergeActivities,
  offerable,
} from './activity'

/**
 * The registry this refactor has to carry forward without losing anything.
 *
 * Reading the stamped file rather than a fixture is deliberate: a fixture
 * keeps passing after somebody adds a key to the real registry that the
 * schema cannot express, which is the regression this guards.
 */
const shippedActivities = () => {
  const path = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'templates',
    'stamp',
    'config',
    'crust.activities.yaml',
  )

  return activitiesFileSchema.parse(Bun.YAML.parse(readFileSync(path, 'utf8')))
    .activities
}

test(
  [
    'given typedefs/activity::activityConfigSchema',
    'when every entry in the shipped registry is parsed',
    'it should accept all of them unchanged',
  ].join(', '),
  () => {
    // given
    const given = shippedActivities()

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

test(
  [
    'given typedefs/activity::activityPatchFileSchema',
    'when a local layer names an Activity and one key',
    'it should parse, because a patch is not a whole Activity',
  ].join(', '),
  () => {
    // given — the full schema rejects this for having no prompts, which
    // would make every partial override an error
    const given = { activities: [{ name: 'builder', thinking: 'high' }] }

    // when
    const actual = activityPatchFileSchema.safeParse(given)

    // then
    expect(actual.success).toBe(true)
  },
)

test(
  [
    'given typedefs/activity',
    'when the shipped local example is merged over the shipped registry',
    'it should produce Activities the full schema accepts',
  ].join(', '),
  () => {
    // given — the example is documentation that runs: a key renamed in the
    // schema has to break it, or it keeps teaching the old shape
    const read = (name: string) =>
      Bun.YAML.parse(
        readFileSync(
          join(
            import.meta.dir,
            '..',
            '..',
            '..',
            'templates',
            'stamp',
            'config',
            name,
          ),
          'utf8',
        ),
      )
    const base = activitiesFileSchema.parse(read('crust.activities.yaml'))
    const local = activityPatchFileSchema.parse(
      read('crust.activities.local.example.yaml'),
    )

    // when
    const actual = activitiesFileSchema.safeParse({
      activities: mergeActivities(
        base.activities as unknown as readonly Record<string, unknown>[],
        local.activities,
      ),
    })

    // then
    expect(actual.success).toBe(true)
  },
)
