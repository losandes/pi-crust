import { expect, test } from 'bun:test'
import type { TStage } from '../typedefs/lifecycle'
import type { TActivity } from '../typedefs/runnable-activity'
import { asSingleStage, plannedNames, unitsFrom } from './plan-units'

const activity = (name: string): TActivity =>
  ({ name, params: { name }, requires: [] }) as unknown as TActivity

const stage = (
  name: string,
  strategy: 'serial' | 'concurrent',
  activities: readonly string[],
): TStage => ({ name, strategy, activities: [...activities] })

test(
  [
    'given use-cases/plan-units::unitsFrom',
    'when a stage is serial',
    'it should make one unit per activity, so a gate can stop between them',
  ].join(', '),
  () => {
    // given
    const given = [stage('design', 'serial', ['plan', 'design'])]

    // when
    const actual = unitsFrom(given, [activity('plan'), activity('design')])

    // then
    expect(actual).toHaveLength(2)
    expect(actual.map((unit) => unit.endsStage)).toEqual([false, true])
  },
)

test(
  [
    'given use-cases/plan-units::unitsFrom',
    'when a stage is concurrent',
    'it should make one unit holding all of them, so none is cut short',
  ].join(', '),
  () => {
    // given
    const given = [stage('accept', 'concurrent', ['review', 'code-review'])]

    // when
    const actual = unitsFrom(given, [activity('review'), activity('code-review')])

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.activities.map((one) => one.name)).toEqual([
      'review',
      'code-review',
    ])
    expect(actual[0]?.endsStage).toEqual(true)
  },
)

test(
  [
    'given use-cases/plan-units::unitsFrom',
    'when a stage names an activity the registry does not have',
    'it should drop it, because refusing belongs where names were resolved',
  ].join(', '),
  () => {
    // given
    const given = [stage('implement', 'serial', ['build', 'imaginary'])]

    // when
    const actual = unitsFrom(given, [activity('build')])

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.activities[0]?.name).toEqual('build')
  },
)

test(
  [
    'given use-cases/plan-units::asSingleStage',
    'when a bare list of activities is planned',
    'it should be one serial Stage, named for its members rather than "activities"',
  ].join(', '),
  () => {
    // given
    const given = ['plan', 'build']

    // when
    const actual = asSingleStage(given)

    // then
    expect(actual).toEqual([
      { name: 'plan..build', strategy: 'serial', activities: ['plan', 'build'] },
    ])
    expect(plannedNames(actual)).toEqual(given)
  },
)
