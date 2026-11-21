import { expect, test } from 'bun:test'
import type { TActivityConfig } from '../../../../lib/contracts'
import { activityConfigSchema } from '../../../../lib/contracts'
import { activityCatalogue } from './activity-catalogue'

const prompts = { system: 'p/system.md', user: 'p/user.md' }

const anActivity = (
  name: string,
  extra: Readonly<Record<string, unknown>> = {},
): TActivityConfig =>
  activityConfigSchema.parse({
    name,
    prompts: prompts,
    ...extra,
  })

test(
  [
    'given use-cases/activity-catalogue::activityCatalogue',
    'when an Activity declares a purpose',
    'it should list its name and purpose on one line',
  ].join(', '),
  () => {
    // given
    const activities = [anActivity('build', { purpose: 'Build the thing' })]

    // when
    const actual = activityCatalogue(activities)

    // then
    expect(actual).toBe('- `build` — Build the thing')
  },
)

test(
  [
    'given use-cases/activity-catalogue::activityCatalogue',
    'when an Activity declares no purpose',
    'it should list only its name, rather than a dangling dash',
  ].join(', '),
  () => {
    // given
    const activities = [anActivity('plan')]

    // when
    const actual = activityCatalogue(activities)

    // then
    expect(actual).toBe('- `plan`')
  },
)

test(
  [
    'given use-cases/activity-catalogue::activityCatalogue',
    'when several Activities are given',
    'it should list one line per Activity, in the order given',
  ].join(', '),
  () => {
    // given
    const activities = [
      anActivity('plan', { purpose: 'Decide the chain' }),
      anActivity('build'),
      anActivity('review', { purpose: 'Check the build' }),
    ]

    // when
    const actual = activityCatalogue(activities)

    // then
    expect(actual).toBe(
      [
        '- `plan` — Decide the chain',
        '- `build`',
        '- `review` — Check the build',
      ].join('\n'),
    )
  },
)

test(
  [
    'given use-cases/activity-catalogue::activityCatalogue',
    'when no Activities are given',
    'it should return the empty string rather than throw',
  ].join(', '),
  () => {
    // given, when
    const actual = activityCatalogue([])

    // then
    expect(actual).toBe('')
  },
)
