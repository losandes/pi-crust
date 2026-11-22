import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activitiesFileSchema,
  activityConfigSchema,
  activityNamed,
  activityPatchFileSchema,
  DEFAULT_ATTEMPTS,
  mergeActivities,
  PLANNER_NAMES,
  plannerConfigSchema,
  plannerFaults,
  promptsSchema,
  TERMINAL_NAMES,
  terminalConfigSchema,
  terminalFaults,
} from './activity'
import { agentConfigSchema, configDefaultsSchema } from './config'

/**
 * The registry this refactor has to carry forward without losing anything.
 *
 * Reading the stamped file rather than a fixture is deliberate: a fixture
 * keeps passing after somebody adds a key to the real registry that the
 * schema cannot express, which is the regression this guards.
 */
const SHIPPED_ACTIVITIES_PATH = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  'templates',
  'stamp',
  'config',
  'crust.activities.yaml',
)

const shippedFile = () =>
  activitiesFileSchema.parse(
    Bun.YAML.parse(readFileSync(SHIPPED_ACTIVITIES_PATH, 'utf8')),
  )

const shippedActivities = () => shippedFile().activities

for (const revise of [undefined, 'custom/revise.md']) {
  test(
    [
      `given prompt configuration with revise ${String(revise)}`,
      'when parsed',
      'it should preserve the optional revise reference',
    ].join(', '),
    () => {
      // given
      const prompts = {
        system: 'system.md',
        user: 'user.md',
        ...(revise === undefined ? {} : { revise }),
      }

      // when
      const actual = promptsSchema.parse(prompts)

      // then
      expect(actual.revise).toBe(revise)
    },
  )
}

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
        prompts: { system: 'system.md', user: 'user.md' },
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
      prompts: { system: 's.md', user: 'u.md' },
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
      prompts: { system: 's.md', user: 'u.md' },
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
      prompts: { system: 's.md', user: 'u.md' },
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
        prompts: { system: 's.md', user: 'u.md' },
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
        prompts: {
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
        prompts: {
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
      { name: 'planner', prompts: { system: 's.md', user: 'u.md' } },
    ]
    const local = [{ name: 'planner', prompts: { system: 'mine.md' } }]

    // when
    const actual = mergeActivities(base, local)

    // then
    expect(actual[0]?.prompts).toEqual({
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
    // The example moved to cookbooks/ (issue #24, 1.10.1): documentation, not
    // a stamp — a repository's own stamped config/ never had an opinion
    // worth shipping twice.
    const local = activityPatchFileSchema.parse(
      Bun.YAML.parse(
        readFileSync(
          join(
            import.meta.dir,
            '..',
            '..',
            '..',
            '..',
            'cookbooks',
            'examples',
            'crust.activities.local.example.yaml',
          ),
          'utf8',
        ),
      ),
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
      prompts: { system: 's.md', user: 'u.md' },
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
    'when the shipped terminal: block is checked',
    'it should find nothing wrong',
  ].join(', '),
  () => {
    // given
    const given = shippedFile().terminal

    // when
    const actual = terminalFaults(given)

    // then
    expect(actual).toEqual([])
    expect(TERMINAL_NAMES).toEqual(['gh-pull-request'])
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
      /terminal Activity 'gh-pull-request' has no entry under terminal:/,
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
      /'gh-merge-request' is under terminal: and is not a terminal Activity/,
    )
  },
)
