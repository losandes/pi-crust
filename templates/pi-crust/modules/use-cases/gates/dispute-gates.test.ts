import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../typedefs/config'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import { reportPassed, violationsOf } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import { disputesSupported } from './dispute-gates'

const runWith = (checks: readonly string[]): TRun =>
  ({
    cfg: crustConfigSchema.parse({
      agents: [],
      routing: {
        checks: checks.map((name) => ({ name, argv: ['true'] })),
      },
    }),
  }) as TRun

const build = (disputes: readonly unknown[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
    changed_files: [],
    commit_message: '',
    disputes,
  }) as TEnvelopeBase

test(
  [
    'given use-cases/gates::disputesSupported',
    'when a build disputes nothing',
    'it should pass vacuously and record nothing',
  ].join(', '),
  () => {
    // given
    const envelope = build([])

    // when
    const actual = disputesSupported.check(envelope, runWith(['lint']))

    // then
    expect(reportPassed(actual)).toEqual(true)
    expect(actual.checks).toEqual([])
  },
)

test(
  [
    'given use-cases/gates::disputesSupported',
    'when a dispute cites a path and a line',
    'it should pass and say what it verified',
  ].join(', '),
  () => {
    // given
    const envelope = build([
      {
        finding: 'the handler is unguarded',
        evidence: 'src/server.ts:42 already guards it',
        reason: 'the reviewer read the wrong file',
      },
    ])

    // when
    const actual = disputesSupported.check(envelope, runWith(['lint']))

    // then
    expect(reportPassed(actual)).toEqual(true)
    expect(actual.checks.map((check) => check.item)).toEqual([
      'dispute[0] names a finding',
      'dispute[0] carries evidence',
      'dispute[0] is open to judgement',
    ])
  },
)

test(
  [
    'given use-cases/gates::disputesSupported',
    'when a dispute offers prose instead of evidence',
    'it should fail and say a refusal is not a dispute',
  ].join(', '),
  () => {
    // given
    const envelope = build([
      { finding: 'the handler is unguarded', evidence: 'I disagree' },
    ])

    // when
    const actual = disputesSupported.check(envelope, runWith(['lint']))

    // then
    expect(violationsOf(actual)).toEqual([
      'dispute[0] carries evidence: a dispute needs a path:line or a command ' +
        'and its exit status — without one it is a refusal',
    ])
  },
)

test(
  [
    'given use-cases/gates::disputesSupported',
    'when a dispute names no finding at all',
    'it should fail because the harness cannot match it to anything',
  ].join(', '),
  () => {
    // given
    const envelope = build([{ finding: '  ', evidence: 'src/a.ts:1' }])

    // when
    const actual = disputesSupported.check(envelope, runWith(['lint']))

    // then
    expect(violationsOf(actual)).toEqual([
      'dispute[0] names a finding: a dispute must quote the blocking item it answers',
    ])
  },
)

test(
  [
    'given use-cases/gates::disputesSupported',
    'when a dispute argues with a finding a declared check decides',
    'it should fail, because exit status is not a matter of opinion',
  ].join(', '),
  () => {
    // given
    const envelope = build([
      {
        finding: 'typecheck reports an error in the new module',
        evidence: 'src/server.ts:42',
      },
    ])

    // when
    const actual = disputesSupported.check(envelope, runWith(['typecheck']))

    // then
    expect(violationsOf(actual)).toEqual([
      'dispute[0] is open to judgement: typecheck is decided by a command ' +
        'verify already ran — fix it; exit status is not a matter of opinion',
    ])
  },
)
