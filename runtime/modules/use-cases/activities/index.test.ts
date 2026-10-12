import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../typedefs/config'
import type { TPiCrustConfig } from '../../typedefs/config'
import { DEFAULT_ACTIVITY_OPTIONS } from '../../typedefs/runnable-activity'
import { requiredAgents, runnableActivities } from './index'

const prompts = { system: 'p/system.md', user: 'p/user.md' }

const anActivity = (
  name: string,
  extra: Readonly<Record<string, unknown>> = {},
) => ({
  name,
  purpose: `Do the ${name} work and report it`,
  prompt_engineering: prompts,
  writes: [`{handoff}/${name}.md`],
  ...extra,
})

const aConfig = (
  activities: readonly Readonly<Record<string, unknown>>[],
): TPiCrustConfig =>
  crustConfigSchema.parse({
    activities,
    agents: activities,
    planners: [
      { name: 'operator', purpose: 'Choose the chain', prompt_engineering: prompts, writes: [] },
      { name: 'triage', purpose: 'Choose the chain and hand it back', prompt_engineering: prompts, writes: [] },
    ],
  })

test(
  [
    'given use-cases/activities::runnableActivities',
    'when the registry declares an Activity',
    'it should own its activity run itself, because an Activity IS an agent',
  ].join(', '),
  () => {
    // given
    const given = aConfig([
      anActivity('plan', { output: 'planOutput', gates: ['artifactsExist'] }),
      anActivity('build', {
        output: 'buildOutput',
        gates: ['diffMatchesClaims', 'checks'],
        attempts: 3,
        commit: true,
      }),
    ])

    // when
    const actual = runnableActivities(['plan', 'build'], given)

    // then — no performer to bridge to: the Activity is the owner
    expect(actual.map((activity) => `${activity.params.kind}:${activity.params.owner}`)).toEqual([
      'agent:plan',
      'agent:build',
    ])
    expect(actual[1]?.gates.map((gate) => gate.name)).toEqual([
      'diff_matches_claims',
      'checks',
    ])
    expect(actual[1]?.attempts).toEqual(3)
    expect(actual[1]?.commit).toEqual(true)
  },
)

test(
  [
    'given use-cases/activities::runnableActivities',
    'when a run was started with --commit false',
    'it should take committing away from an Activity that declared it',
  ].join(', '),
  () => {
    // given
    const given = aConfig([
      anActivity('build', { output: 'buildOutput', commit: true }),
    ])

    // when
    const actual = runnableActivities(['build'], given, { committing: false })

    // then
    expect(actual[0]?.commit).toEqual(false)
  },
)

test(
  [
    'given use-cases/activities::runnableActivities',
    'when an Activity is named more than once',
    'it should number the repeats, which is what each budget is kept against',
  ].join(', '),
  () => {
    // given
    const given = aConfig([
      anActivity('build', { output: 'buildOutput' }),
      anActivity('review', { output: 'reviewOutput' }),
    ])

    // when
    const actual = runnableActivities(['build', 'review', 'build', 'review'], given)

    // then
    expect(actual.map((activity) => activity.instance)).toEqual([
      'build',
      'review',
      'build_2',
      'review_2',
    ])
    expect(actual.map((activity) => activity.name)).toEqual([
      'build',
      'review',
      'build',
      'review',
    ])
  },
)

test(
  [
    'given use-cases/activities::runnableActivities',
    'when a name is not an Activity this repository offers',
    'it should throw and list the ones that are',
  ].join(', '),
  () => {
    // given
    const given = aConfig([anActivity('plan', { output: 'planOutput' })])

    // when, then
    expect(() => runnableActivities(['plan', 'deploy'], given)).toThrow(
      /unknown activity\(s\): deploy[\s\S]*offers plan/,
    )
  },
)

test(
  [
    'given use-cases/activities::runnableActivities',
    'when a Planner is resolved',
    'it should carry the gate the engine owns rather than one a team declared',
  ].join(', '),
  () => {
    // given
    const given = aConfig([anActivity('plan', { output: 'planOutput' })])

    // when
    const actual = runnableActivities(['operator'], given)

    // then
    expect(actual[0]?.params.owner).toEqual('operator')
    expect(actual[0]?.gates.map((gate) => gate.name)).toEqual(['steps_valid'])
    expect(actual[0]?.commit).toEqual(false)
  },
)

test(
  [
    'given use-cases/activities::runnableActivities',
    'when no --scope was given',
    'it should default to the empty selector so a activity can tell that apart from --scope main',
  ].join(', '),
  () => {
    // given, when, then
    expect(DEFAULT_ACTIVITY_OPTIONS.base).toEqual('')
  },
)

test(
  [
    'given use-cases/activities::requiredAgents',
    'when a chain names one Activity twice',
    'it should name each agent once, so validation does not repeat itself',
  ].join(', '),
  () => {
    // given
    const given = aConfig([
      anActivity('build', { output: 'buildOutput' }),
      anActivity('review', { output: 'reviewOutput' }),
    ])

    // when
    const actual = requiredAgents(
      runnableActivities(['build', 'review', 'build'], given),
    )

    // then
    expect(actual).toEqual(['build', 'review'])
  },
)
