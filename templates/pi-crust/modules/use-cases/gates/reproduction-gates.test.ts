import { expect, test } from 'bun:test'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TRun } from '../../typedefs/run'
import { reproductionSupported } from './claim-gates'

/** This gate reads only the envelope, so the run is never touched. */
const NO_RUN = {} as TRun

const diagnosis = (
  overrides: Readonly<Record<string, unknown>>,
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'a cause',
    artifacts: [],
    notes_for_next_agent: '',
    reproduced: true,
    steps_to_reproduce: ['run the thing', 'watch it stop'],
    root_cause: 'the cursor advances before the page is consumed',
    evidence: ['bun test exited 1'],
    confidence: 'confirmed',
    suspect_files: ['src/paging.ts'],
    reproducing_test: 'src/paging.test.ts',
    unresolved: [],
    ...overrides,
  }) as unknown as TEnvelopeBase

const failed = (envelope: TEnvelopeBase): readonly string[] =>
  reproductionSupported
    .check(envelope, NO_RUN)
    .checks.filter((check) => !check.ok)
    .map((check) => check.item)

test(
  [
    'given use-cases/gates::reproductionSupported',
    'when a diagnosis reproduced the bug and says how',
    'it should pass every check',
  ].join(', '),
  () => {
    // given
    const envelope = diagnosis({})

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/gates::reproductionSupported',
    'when a diagnosis claims a reproduction but records no steps',
    'it should refuse it',
  ].join(', '),
  () => {
    // given — a reproduction nobody else can run is indistinguishable from one
    // that never happened
    const envelope = diagnosis({ steps_to_reproduce: [] })

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toContain('steps_to_reproduce')
  },
)

test(
  [
    'given use-cases/gates::reproductionSupported',
    'when a cause is called confirmed without a reproduction',
    'it should refuse it',
  ].join(', '),
  () => {
    // given — the exact confusion the diagnose stage exists to stop
    const envelope = diagnosis({
      reproduced: false,
      steps_to_reproduce: [],
      confidence: 'confirmed',
      unresolved: [{ question: 'which build?', consequential: true }],
    })

    // when
    const actual = failed(envelope)

    // then — a cause you reasoned your way to is at most 'likely'
    expect(actual).toContain('confidence')
  },
)

test(
  [
    'given use-cases/gates::reproductionSupported',
    'when it could not reproduce the bug and asked nobody anything',
    'it should refuse it',
  ].join(', '),
  () => {
    // given
    const envelope = diagnosis({
      reproduced: false,
      steps_to_reproduce: [],
      confidence: 'unproven',
      unresolved: [],
    })

    // when
    const actual = failed(envelope)

    // then — otherwise the run ends quietly instead of escalating to a human
    expect(actual).toContain('escalation')
  },
)

test(
  [
    'given use-cases/gates::reproductionSupported',
    'when it could not reproduce the bug but said what it would need',
    'it should accept that as a complete report',
  ].join(', '),
  () => {
    // given — failing to reproduce is a finding, not a failure
    const envelope = diagnosis({
      reproduced: false,
      steps_to_reproduce: [],
      confidence: 'unproven',
      reproducing_test: '',
      unresolved: [
        { question: 'which app version did the user have?', consequential: true },
      ],
    })

    // when
    const actual = failed(envelope)

    // then
    expect(actual).toEqual([])
  },
)
