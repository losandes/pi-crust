import { expect, test } from 'bun:test'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import { violationsOf } from '../../../../lib/contracts'
import { stepsValid } from './plan-gates'

/*
 * The registry is the run's, because Activities are configuration: what
 * exists is whatever `crust.activities.yaml` turned out to hold.
 */
const anyRun = {
  cfg: {
    activities: [
      { name: 'identify' },
      { name: 'conceptualize' },
      { name: 'plan' },
      { name: 'build' },
    ],
  },
} as unknown as TRun

const planOf = (activities: readonly unknown[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    // `steps` is the operator envelope's published field name; the
    // vocabulary around it is Activities, the wire key is not renamed.
    steps: activities,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/gates::stepsValid',
    'when every planned activity is a real one',
    'it should pass and record the chain it verified',
  ].join(' '),
  () => {
    // given
    const envelope = planOf(['identify', 'plan', 'build'])

    // when
    const report = stepsValid.check(envelope, anyRun, [])

    // then
    expect(violationsOf(report)).toEqual([])
    expect(report.checks).toHaveLength(3)
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the operator invents a activity name',
    'it should refuse and list the activities that do exist',
  ].join(' '),
  () => {
    // given
    const envelope = planOf(['identify', 'analyse', 'build'])

    // when
    const report = stepsValid.check(envelope, anyRun, [])

    // then
    const violations = violationsOf(report)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('not an Activity this repository offers')
    expect(violations[0]).toContain('conceptualize')
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the plan contains a Planner',
    'it should refuse, because a Planner cannot plan a Planner',
  ].join(' '),
  () => {
    // given
    const envelope = planOf(['operator', 'build'])

    // when
    const report = stepsValid.check(envelope, anyRun, [])

    // then
    expect(violationsOf(report)[0]).toContain('cannot plan a ')
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the plan is empty',
    'it should refuse rather than let a run of no activities report success',
  ].join(' '),
  () => {
    // given
    const envelope = planOf([])

    // when
    const report = stepsValid.check(envelope, anyRun, [])

    // then
    expect(violationsOf(report)[0]).toContain('no activities planned')
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the activities field holds values that are not strings',
    'it should discard them rather than coerce a number into a activity name',
  ].join(' '),
  () => {
    // given
    const envelope = planOf([7, { activity: 'build' }])

    // when
    const report = stepsValid.check(envelope, anyRun, [])

    // then
    expect(violationsOf(report)[0]).toContain('no activities planned')
  },
)
