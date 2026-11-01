import { expect, test } from 'bun:test'
import { activityConfigSchema } from '../typedefs/activity'
import { lifecycleConfigSchema } from '../typedefs/lifecycle'
import {
  chosenPlanner,
  exclusiveCount,
  expandChoices,
  menuOptions,
} from './menu-options'

const activity = (name: string, over: Record<string, unknown> = {}) =>
  activityConfigSchema.parse({
    name,
    prompt_engineering: { system: 's.md', user: 'u.md' },
    ...over,
  })

const sdlc = lifecycleConfigSchema.parse(
  Bun.YAML.parse(`
name: sdlc
description: the whole thing
stages:
  - name: discover
    activities: [identify]
  - name: implement
    activities: [build]
`),
)

test(
  [
    'given use-cases/menu-options::menuOptions',
    'when an activity is hidden',
    'it should not be offered',
  ].join(', '),
  () => {
    // given — the regression this test exists for: `hidden` reached nothing,
    // and an empty list of hidden things looks exactly like a working filter.
    const given = [
      activity('plan'),
      activity('security-research', { hidden: true }),
    ]

    // when
    const actual = menuOptions(given, []).map((option) => option.value)

    // then
    expect(actual).toContain('plan')
    expect(actual).not.toContain('security-research')
  },
)

test(
  [
    'given use-cases/menu-options::menuOptions',
    'when an Activity declares aliases',
    'it should contribute exactly one option, valued at its canonical name',
  ].join(', '),
  () => {
    // given
    const given = [activity('gh-pull-request', { aliases: ['gh-pr'] })]

    // when
    const actual = menuOptions(given, []).map((option) => option.value)

    // then
    expect(actual.filter((value) => value.includes('gh-pull-request'))).toEqual([
      'gh-pull-request',
    ])
    expect(actual).not.toContain('gh-pr')
  },
)

test(
  [
    'given use-cases/menu-options::menuOptions',
    'when the menu lists the work',
    'it should offer the Activity names, because its values become --activities',
  ].join(', '),
  () => {
    // given — an entry is named for the work, and the menu feeds the runner
    const given = [activity('plan'), activity('build')]

    // when
    const actual = menuOptions(given, []).map((option) => option.value)

    // then
    expect(actual).toEqual(['!operator', '  plan'.trim(), 'build'])
  },
)

test(
  [
    'given use-cases/menu-options::menuOptions',
    'when the registry holds only work',
    'it should still offer the Planner, because a Planner is not configurable',
  ].join(', '),
  () => {
    // given — Planners live under `planners:` and are never Activities, so
    // nothing a team writes under `activities:` can add or remove one
    const given = [activity('plan')]

    // when
    const actual = menuOptions(given, []).map((option) => option.value)

    // then
    expect(actual.filter((value) => value.includes('operator'))).toEqual([
      '!operator',
    ])
    expect(actual).not.toContain('triage')
  },
)

test(
  [
    'given use-cases/menu-options::menuOptions',
    'when lifecycles are registered',
    'it should offer them first, with the description the config gives',
  ].join(', '),
  () => {
    // given
    const given = menuOptions([activity('plan')], [sdlc])

    // when
    const actual = given[0]

    // then
    expect(actual?.value).toBe('@sdlc')
    expect(actual?.detail).toBe('the whole thing')
  },
)

test(
  [
    'given use-cases/menu-options::expandChoices',
    'when a lifecycle is chosen',
    'it should expand to the order the composer would run',
  ].join(', '),
  () => {
    // given
    const given = ['@sdlc']

    // when
    const actual = expandChoices(given, [sdlc])

    // then
    expect(actual).toEqual(['identify', 'build'])
  },
)

test(
  [
    'given use-cases/menu-options::exclusiveCount',
    'when a team adds a lifecycle',
    'it should still cover every option that answers the whole question',
  ].join(', '),
  () => {
    // given
    const given = [sdlc, sdlc, sdlc]

    // when
    const actual = exclusiveCount(given)

    // then
    expect(actual).toBe(4)
  },
)

test(
  [
    'given use-cases/menu-options::chosenPlanner',
    'when a planner was picked',
    'it should be named without its prefix',
  ].join(', '),
  () => {
    // given
    const given = ['!operator']

    // when
    const actual = chosenPlanner(given)

    // then
    expect(actual).toBe('operator')
  },
)
