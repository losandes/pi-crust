import { expect, test } from 'bun:test'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import {
  crustConfigSchema,
  reportPassed,
  violationsOf,
} from '../../../../lib/contracts'
import { disputesSupported } from './dispute-gates'

const runWith = (checks: readonly string[]): TRun =>
  ({
    cfg: crustConfigSchema.parse({
      agents: [],
      tasks: Object.fromEntries(
        checks.map((name) => [name, { when: [{ on: 'change' }], run: 'true' }]),
      ),
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
    'when a revise neither rewrites a file nor disputes a finding',
    'it should fail rather than send the reviewers nothing to re-examine',
  ].join(', '),
  () => {
    // given
    const envelope = build([])

    // when
    const actual = disputesSupported.check(envelope, runWith(['lint']), [])

    // then
    expect(reportPassed(actual)).toEqual(false)
    expect(violationsOf(actual)).toEqual([
      'review answered: a revise must report at least one changed file or a supported dispute',
    ])
  },
)

test(
  [
    'given use-cases/gates::disputesSupported',
    'when a plan revise reports the rewritten plan without a dispute',
    'it should pass because a rewrite answers the review too',
  ].join(', '),
  () => {
    // given
    const envelope = { ...build([]), changed_files: ['handoff/plan.md'] }

    // when
    const actual = disputesSupported.check(envelope, runWith([]), [])

    // then
    expect(reportPassed(actual)).toBe(true)
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
    const actual = disputesSupported.check(envelope, runWith(['lint']), [])

    // then
    expect(reportPassed(actual)).toEqual(true)
    expect(actual.checks.map((check) => check.item)).toEqual([
      'review answered',
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
    const actual = disputesSupported.check(envelope, runWith(['lint']), [])

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
    const actual = disputesSupported.check(envelope, runWith(['lint']), [])

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
    const actual = disputesSupported.check(envelope, runWith(['typecheck']), [])

    // then
    expect(violationsOf(actual)).toEqual([
      'dispute[0] is open to judgement: typecheck is decided by a command ' +
        'verify already ran — fix it; exit status is not a matter of opinion',
    ])
  },
)
