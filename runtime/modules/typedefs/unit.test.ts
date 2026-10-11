import { expect, test } from 'bun:test'
import { activityGates, wantsStageGate } from './unit'

test(
  [
    'given typedefs/unit::wantsStageGate',
    'when a gate list names a stage with the prefix',
    'it should recognise it, and not the bare activity of the same name',
  ].join(', '),
  () => {
    // given
    const given = ['plan', 'stage:accept']

    // when, then
    expect(wantsStageGate(given, 'accept')).toEqual(true)
    expect(wantsStageGate(given, 'plan')).toEqual(false)
  },
)

test(
  [
    'given typedefs/unit::activityGates',
    'when a gate list mixes activities and stages',
    'it should keep only the activities, so neither kind matches the other',
  ].join(', '),
  () => {
    // given
    const given = ['plan', 'stage:accept', 'build']

    // when
    const actual = activityGates(given)

    // then
    expect(actual).toEqual(['plan', 'build'])
  },
)
