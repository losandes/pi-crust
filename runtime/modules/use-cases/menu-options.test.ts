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
    // `security-researcher` performs the `security-research` step.
    const given = [activity('security-researcher', { hidden: true })]

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
    'when the menu lists the work',
    'it should offer step names, because its values become --steps',
  ].join(', '),
  () => {
    // given — a registry entry is named for the performer, a step for the
    // work, and the menu feeds the runner
    const given = [activity('planner'), activity('builder')]

    // when
    const actual = menuOptions(given, []).map((option) => option.value)

    // then
    expect(actual).toContain('plan')
    expect(actual).not.toContain('planner')
  },
)

test(
  [
    'given use-cases/menu-options::menuOptions',
    'when a planner is also registered as an activity',
    'it should appear once, as a planner rather than as work to pick',
  ].join(', '),
  () => {
    // given
    const given = [activity('operator'), activity('triage')]

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
    const given = menuOptions([activity('planner')], [sdlc])

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
