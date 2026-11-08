import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../../../lib/contracts'
import { parseActivities } from './parse-activities'

/**
 * A roster with the one property the concurrency check reads: `writes`.
 *
 * `review` and `code-review` write only their own findings, so they may run
 * at once. `build` and `test` both reach the tree, so they may not — and that
 * pair is the one a developer discovers by guessing.
 */
const cfg = crustConfigSchema.parse({
  activities: [
    { name: 'plan', writes: ['{handoff}/plan.md'] },
    { name: 'build', writes: ['*'] },
    { name: 'test', writes: ['*'] },
    { name: 'review', writes: ['{handoff}/review.md'] },
    { name: 'code-review', writes: ['{handoff}/code-review.md'] },
    { name: 'gh-pull-request', writes: [], aliases: ['gh-pr'] },
  ].map((activity) => ({
    purpose: `Do the ${activity.name} work`,
    prompt_engineering: { system: 's.md', user: 'u.md' },
    ...activity,
  })),
})

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when the chain is a plain comma-separated list',
    'it should be ONE serial Stage, exactly as --steps always meant',
  ].join(', '),
  () => {
    // given
    const given = 'plan,build,test'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.strategy).toBe('serial')
    expect(actual[0]?.activities).toEqual(['plan', 'build', 'test'])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a group joins two Activities with +',
    'it should be a concurrent Stage of both',
  ].join(', '),
  () => {
    // given
    const given = 'review+code-review'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.strategy).toBe('concurrent')
    expect(actual[0]?.activities).toEqual(['review', 'code-review'])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when singles and a concurrent group are mixed',
    'it should fold the singles into one serial Stage and keep the group its own',
  ].join(', '),
  () => {
    // given — the shape a developer actually types
    const given = 'plan,build,review+code-review'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual.map((stage) => stage.strategy)).toEqual([
      'serial',
      'concurrent',
    ])
    expect(actual[0]?.activities).toEqual(['plan', 'build'])
    expect(actual[1]?.activities).toEqual(['review', 'code-review'])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a Stage is derived rather than named',
    'it should name itself from its members, because nothing else can',
  ].join(', '),
  () => {
    // given
    const given = 'plan,build,review+code-review'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual.map((stage) => stage.name)).toEqual([
      'plan..build',
      'review+code-review',
    ])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a concurrent group names two Activities that both write code',
    'it should refuse before anything runs, naming both',
  ].join(', '),
  () => {
    // given — the mistake a developer makes by guessing
    const given = 'build+test'

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/build/)
    expect(actual).toThrow(/test/)
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when that same pair is serial instead',
    'it should be allowed, because serially there is nothing to race',
  ].join(', '),
  () => {
    // given
    const given = 'build,test'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual[0]?.activities).toEqual(['build', 'test'])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a name is not an Activity this repository offers',
    'it should refuse at parse and list the ones that are',
  ].join(', '),
  () => {
    // given
    const given = 'plan,deploy'

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/unknown activity\(s\): deploy/)
    expect(actual).toThrow(/code-review/)
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when --activities names an alias',
    'it should produce a Stage whose activities and name are canonical',
  ].join(', '),
  () => {
    // given
    const given = 'plan,gh-pr'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual.flatMap((stage) => stage.activities)).toEqual([
      'plan',
      'gh-pull-request',
    ])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a name is an undeclared prefix of a canonical name',
    'it should remain unknown, because there is no prefix matching',
  ].join(', '),
  () => {
    // given
    const given = 'gh-p'

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/unknown activity\(s\): gh-p/)
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a Planner is named inside a chain',
    'it should refuse, because a Planner chooses a chain rather than joining one',
  ].join(', '),
  () => {
    // given
    const given = 'plan,operator'

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/operator cannot be named in a chain/)
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when the flag was given nothing',
    'it should say what the flag is for and what this repository offers',
  ].join(', '),
  () => {
    // given
    const given = undefined

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/--activities is required/)
    expect(actual).toThrow(/plan, build, test/)
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a repeat appears in the chain',
    'it should keep both, because a fix loop written longhand is meaningful',
  ].join(', '),
  () => {
    // given
    const given = 'build,review,build,review'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual[0]?.activities).toEqual([
      'build',
      'review',
      'build',
      'review',
    ])
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a terminal Activity ends the chain',
    'it should load it as the last entry of the last stage',
  ].join(', '),
  () => {
    // given
    const given = 'build,gh-pull-request'

    // when
    const actual = parseActivities(given, cfg.activities)

    // then
    expect(actual.at(-1)?.activities.at(-1)).toEqual('gh-pull-request')
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a terminal Activity is named before the end of the chain',
    'it should refuse',
  ].join(', '),
  () => {
    // given
    const given = 'gh-pull-request,build'

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/'gh-pull-request' is a terminal Activity/)
  },
)

test(
  [
    'given use-cases/parse-activities::parseActivities',
    'when a terminal Activity is grouped concurrently with another',
    'it should refuse, because it does not run alongside anything',
  ].join(', '),
  () => {
    // given
    const given = 'build+gh-pull-request'

    // when
    const actual = () => parseActivities(given, cfg.activities)

    // then
    expect(actual).toThrow(/'gh-pull-request' is a terminal Activity/)
  },
)
