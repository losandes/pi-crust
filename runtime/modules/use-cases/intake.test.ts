import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../typedefs/envelope'
import { intakeRejection, intakeViolations } from './intake'

const context = (
  fields: Readonly<Record<string, unknown>>,
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'did the thing',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'bun test exit 0' },
    regress_to: { activity: '', because: '' },
    ...fields,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the incoming context is complete',
    'it should report nothing, leaving the judgement to the agent',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      facts: [{ fact: 'the suite is green', evidence: 'bun test exit 0' }],
    })

    // when
    const actual = intakeViolations(envelope, 'build')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a decision carries no rationale',
    'it should refuse, because this stage would have to re-decide it',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      decisions: [{ decision: 'store it in Postgres', rationale: '  ' }],
    })

    // when
    const actual = intakeViolations(envelope, 'design')

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]).toContain('store it in Postgres')
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when an assumption names nothing that would disprove it',
    'it should refuse, because it can never trigger a regression',
  ].join(', '),
  () => {
    // given
    const envelope = context({
      assumptions: [{ assumption: 'the feed is daily', invalidated_by: '' }],
    })

    // when
    const actual = intakeViolations(envelope, 'plan')

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]).toContain('the feed is daily')
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a stage claims its objective was met without evidence',
    'it should refuse, because that claim is the one to doubt',
  ].join(', '),
  () => {
    // given
    const envelope = context({ objective_met: { met: true, evidence: '' } })

    // when
    const actual = intakeViolations(envelope, 'identify')

    // then
    expect(actual).toHaveLength(1)
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when a stage says plainly that it did NOT meet its objective',
    'it should report nothing structural, because honesty is not a defect',
  ].join(', '),
  () => {
    // given
    const envelope = context({ objective_met: { met: false, evidence: '' } })

    // when
    const actual = intakeViolations(envelope, 'identify')

    // then — the agent decides what to do about it; the shape is fine
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeViolations',
    'when the envelope is not a context envelope at all',
    'it should report nothing, because a code activityRun has no beliefs to state',
  ].join(', '),
  () => {
    // given a verify envelope, which code builds
    const envelope = {
      status: 'success',
      summary: 'checks ran',
      passed: true,
      failures: [],
    } as unknown as TEnvelopeBase

    // when
    const actual = intakeViolations(envelope, 'verify')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/intake::intakeRejection',
    'when there are violations',
    'it should name the receiving activity and send the fix upstream',
  ].join(', '),
  () => {
    // given
    const violations = ["'plan' records a decision with no rationale"]

    // when
    const actual = intakeRejection(violations, 'build')

    // then
    expect(actual).toContain("'build' will not start")
    expect(actual).toContain('Fix the stage that produced it')
  },
)
