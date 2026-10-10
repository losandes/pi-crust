import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import { violationsOf } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import { stepsValid } from './plan-gates'

// stepsValid reads only the envelope; the run is in the signature for gates
// that shell out, and is never touched here.
const anyRun = {} as TRun

const planOf = (steps: readonly unknown[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    steps,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/gates::stepsValid',
    'when every planned step is a real one',
    'it should pass and record the chain it verified',
  ].join(' '),
  () => {
    // given
    const envelope = planOf(['identify', 'plan', 'build', 'verify'])

    // when
    const report = stepsValid.check(envelope, anyRun)

    // then
    expect(violationsOf(report)).toEqual([])
    expect(report.checks).toHaveLength(4)
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the operator invents a step name',
    'it should refuse and list the steps that do exist',
  ].join(' '),
  () => {
    // given
    const envelope = planOf(['identify', 'analyse', 'build'])

    // when
    const report = stepsValid.check(envelope, anyRun)

    // then
    const violations = violationsOf(report)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('not a pi-crust step')
    expect(violations[0]).toContain('conceptualize')
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the plan contains another operator',
    'it should refuse, because the second would replan the first chain',
  ].join(' '),
  () => {
    // given
    const envelope = planOf(['operator', 'build'])

    // when
    const report = stepsValid.check(envelope, anyRun)

    // then
    expect(violationsOf(report)[0]).toContain('cannot plan an operator')
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the plan is empty',
    'it should refuse rather than let a run of no steps report success',
  ].join(' '),
  () => {
    // given
    const envelope = planOf([])

    // when
    const report = stepsValid.check(envelope, anyRun)

    // then
    expect(violationsOf(report)[0]).toContain('no steps planned')
  },
)

test(
  [
    'given use-cases/gates::stepsValid',
    'when the steps field holds values that are not strings',
    'it should discard them rather than coerce a number into a step name',
  ].join(' '),
  () => {
    // given
    const envelope = planOf([7, { step: 'build' }])

    // when
    const report = stepsValid.check(envelope, anyRun)

    // then
    expect(violationsOf(report)[0]).toContain('no steps planned')
  },
)
