import { expect, test } from 'bun:test'
import { activityRunParams } from './activity-run'

test(
  [
    'given typedefs/activityRun::activityRunParams',
    'when the description explains the activity-run',
    'it should normalise the whitespace and keep every field',
  ].join(', '),
  () => {
    // given
    const input = {
      name: 'commit_plan',
      kind: 'code',
      owner: 'git',
      description: '  Put the spec on record   before any code\n exists ',
    } as const

    // when
    const actual = activityRunParams(input)

    // then
    expect(actual).toEqual({
      name: 'commit_plan',
      kind: 'code',
      owner: 'git',
      description: 'Put the spec on record before any code exists',
      retries: 0,
    })
  },
)

test(
  [
    'given typedefs/activityRun::activityRunParams',
    'when the description is blank',
    'it should throw at construction rather than open the activity-run',
  ].join(', '),
  () => {
    // given
    const input = {
      name: 'plan',
      kind: 'agent',
      owner: 'planner',
      description: '   ',
    } as const

    // when, then
    expect(() => activityRunParams(input)).toThrow(/description is required/)
  },
)

test(
  [
    'given typedefs/activityRun::activityRunParams',
    'when the description only restates the activityRun name',
    'it should throw naming the echo',
  ].join(', '),
  () => {
    // given
    const input = {
      name: 'commit_plan',
      kind: 'code',
      owner: 'git',
      description: 'Commit plan.',
    } as const

    // when, then
    expect(() => activityRunParams(input)).toThrow(/only restates the activityRun name/)
  },
)

test(
  [
    'given typedefs/activityRun::activityRunParams',
    'when retries are given',
    'it should carry them through',
  ].join(', '),
  () => {
    // given
    const input = {
      name: 'build',
      kind: 'agent',
      owner: 'builder',
      description: 'Implement the plan exactly',
      retries: 2,
    } as const

    // when
    const actual = activityRunParams(input)

    // then
    expect(actual.retries).toEqual(2)
  },
)
