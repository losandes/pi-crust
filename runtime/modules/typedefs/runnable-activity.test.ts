import { expect, test } from 'bun:test'
import type { TActivityOutcome } from './runnable-activity'
import {
  acceptedExcluding,
  activityRunName,
  allAccepted,
} from './runnable-activity'

test(
  [
    'given typedefs/runnable-activity::allAccepted',
    'when every outcome accepted',
    'it should say the whole set held',
  ].join(', '),
  () => {
    // given
    const outcomes: readonly TActivityOutcome[] = [
      { activity: 'build', accepted: true },
      { activity: 'review', accepted: true },
    ]

    // when
    const actual = allAccepted(outcomes)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/runnable-activity::allAccepted',
    'when one outcome did not accept',
    'it should say the set did not hold',
  ].join(', '),
  () => {
    // given
    const outcomes: readonly TActivityOutcome[] = [
      { activity: 'build', accepted: true },
      { activity: 'review', accepted: false },
    ]

    // when
    const actual = allAccepted(outcomes)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given typedefs/runnable-activity::acceptedExcluding',
    'when the only rejection is one of the excluded activities',
    'it should hold, because the revise loop is about to re-ask it',
  ].join(', '),
  () => {
    // given
    const outcomes: readonly TActivityOutcome[] = [
      { activity: 'build', accepted: true },
      { activity: 'review', accepted: false },
    ]

    // when
    const actual = acceptedExcluding(outcomes, ['review'])

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/runnable-activity::acceptedExcluding',
    'when a rejection belongs to an activity that is not excluded',
    'it should stay decisive and report the set as not held',
  ].join(', '),
  () => {
    // given
    const outcomes: readonly TActivityOutcome[] = [
      { activity: 'build', accepted: true },
      { activity: 'checks', accepted: false },
    ]

    // when
    const actual = acceptedExcluding(outcomes, ['review'])

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given typedefs/runnable-activity::activityRunName',
    'when this is the first occurrence of the activity',
    'it should use the bare name, with no suffix',
  ].join(', '),
  () => {
    // given, when
    const actual = activityRunName('build', 1)

    // then
    expect(actual).toEqual('build')
  },
)

test(
  [
    'given typedefs/runnable-activity::activityRunName',
    'when this is a repeated occurrence of the activity',
    'it should suffix the name with the instance number',
  ].join(', '),
  () => {
    // given, when
    const actual = activityRunName('build', 2)

    // then
    expect(actual).toEqual('build_2')
  },
)
