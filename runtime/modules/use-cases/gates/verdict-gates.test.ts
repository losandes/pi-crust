import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import { reportPassed, violationsOf } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import { verdictConsistent } from './verdict-gates'

const anyRun = {} as TRun

const review = (fields: Readonly<Record<string, unknown>>): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    ...fields,
  }) as TEnvelopeBase

test(
  [
    'given use-cases/gates::verdictConsistent',
    'when a review approves with nothing blocking',
    'it should pass and record what it verified',
  ].join(', '),
  () => {
    // given
    const envelope = review({
      approved: true,
      blocking: [],
      findings: [
        { requirement: 'a /health route', met: true, evidence: 'src' },
      ],
    })

    // when
    const actual = verdictConsistent.check(envelope, anyRun, [])

    // then
    expect(reportPassed(actual)).toEqual(true)
    expect(actual.checks.map((check) => check.item)).toEqual([
      'approved vs blocking',
      'approved vs findings',
      'rejection names a problem',
    ])
  },
)

test(
  [
    'given use-cases/gates::verdictConsistent',
    'when a review approves while naming blocking items',
    'it should fail with the contradiction named',
  ].join(', '),
  () => {
    // given
    const envelope = review({
      approved: true,
      blocking: ['no tests'],
      findings: [],
    })

    // when
    const actual = verdictConsistent.check(envelope, anyRun, [])

    // then
    expect(violationsOf(actual)).toEqual([
      'approved vs blocking: 1 blocking item(s) while approved=true',
    ])
  },
)

test(
  [
    'given use-cases/gates::verdictConsistent',
    'when a review approves while a requirement is unmet',
    'it should fail on the findings check',
  ].join(', '),
  () => {
    // given
    const envelope = review({
      approved: true,
      blocking: [],
      findings: [{ requirement: 'a /health route', met: false, evidence: '' }],
    })

    // when
    const actual = verdictConsistent.check(envelope, anyRun, [])

    // then
    expect(violationsOf(actual)).toEqual([
      'approved vs findings: 1 unmet requirement(s) while approved=true',
    ])
  },
)

test(
  [
    'given use-cases/gates::verdictConsistent',
    'when a review rejects without naming a single problem',
    'it should fail because the verdict is unsupported',
  ].join(', '),
  () => {
    // given
    const envelope = review({ approved: false, blocking: [], findings: [] })

    // when
    const actual = verdictConsistent.check(envelope, anyRun, [])

    // then
    expect(violationsOf(actual)).toEqual([
      'rejection names a problem: approved=false but no blocking item or unmet requirement was given',
    ])
  },
)
