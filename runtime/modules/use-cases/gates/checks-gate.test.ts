import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crustConfigSchema } from '../../typedefs/config'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import { violationsOf } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import { checkedPaths, checks, checksReport } from './checks-gate'

/**
 * A run with a real repo root and a tracer that forgets, because this gate
 * genuinely shells out — that is the whole reason it is a gate and not a
 * pure predicate over an envelope.
 */
const runWith = (routing: Readonly<Record<string, unknown>>): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-checks-'))

  return {
    cfg: crustConfigSchema.parse({ routing, agents: [] }),
    runId: 'aaaa1111',
    repoRoot: dir,
    contextHandoffDir: dir,
    activityRuns: () => [],
    console: { note: () => undefined },
    tracer: { event: () => undefined },
  } as unknown as TRun
}

const built = (changed: readonly string[]): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'built it',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'it builds' },
    regress_to: { activity: '', because: '' },
    changed_files: changed,
  }) as unknown as TEnvelopeBase

test(
  [
    'given use-cases/gates::checks',
    "when a declared command fails for the paths the Activity changed",
    'it should fail the gate with the command output, which is what the Activity is told',
  ].join(', '),
  () => {
    /*
     * given — `verify` used to be an Activity producing a verdict nothing
     * consumed. What it actually does is decide whether an Activity's work
     * holds, which is what a gate is, and a failing gate feeds its
     * violations back to the Activity it gates.
     */
    const run = runWith({
      checks: [
        {
          name: 'tests',
          when: ['**/*.ts'],
          operation: 'test',
          argv: ['sh', '-c', 'echo "1 test failed" && exit 1'],
        },
      ],
    })

    // when
    const actual = checks.check(built(['src/a.ts']), run, ['src/a.ts'])

    // then
    const violations = violationsOf(actual)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('tests:')
    expect(violations[0]).toContain('1 test failed')
  },
)

test(
  [
    'given use-cases/gates::checks',
    'when every declared command passes',
    'it should hold, and say what it ran rather than only that it passed',
  ].join(', '),
  () => {
    // given
    const run = runWith({
      checks: [
        {
          name: 'typecheck',
          when: ['**/*.ts'],
          operation: 'typecheck',
          argv: ['true'],
        },
      ],
    })

    // when
    const actual = checks.check(built(['src/a.ts']), run, ['src/a.ts'])

    // then
    expect(violationsOf(actual)).toEqual([])
    expect(actual.checks[0]?.item).toEqual('typecheck')
  },
)

test(
  [
    'given use-cases/gates::checks',
    'when paths changed and no declared rule matched them',
    'it should fail, because zero checks passing is not zero checks failing',
  ].join(', '),
  () => {
    // given — a rule that cannot reach a nested file
    const run = runWith({
      checks: [{ name: 'lint', when: ['*.ts'], operation: 'lint', argv: ['true'] }],
    })

    // when
    const actual = checks.check(built(['src/deep/a.ts']), run, [
      'src/deep/a.ts',
    ])

    // then
    expect(violationsOf(actual)[0]).toContain('no routing.checks')
  },
)

test(
  [
    'given use-cases/gates::checks',
    'when the driver observed no paths',
    "it should fall back to the Activity's own claim rather than judging nothing",
  ].join(', '),
  () => {
    // given
    const given = built(['src/b.ts', 'src/a.ts'])

    // when
    const actual = checkedPaths(given, [])

    // then
    expect(actual).toEqual(['src/a.ts', 'src/b.ts'])
  },
)

test(
  [
    'given use-cases/gates::checks',
    'when the gate reads the working tree',
    'it should say so, which is what defers it to the Stage boundary',
  ].join(', '),
  () => {
    // given — inside a concurrent Stage a sibling may still be writing
    const given = checks

    // when
    const actual = given.readsTree

    // then
    expect(actual).toEqual(true)
  },
)

test(
  [
    'given use-cases/gates::checks',
    'when the repository has declared no checks',
    'it should pass and SAY why, so green is not mistaken for coverage',
  ].join(', '),
  () => {
    // given
    const run = runWith({ checks: [] })

    // when
    const actual = checksReport(run, ['src/add.ts'])

    // then
    expect(violationsOf(actual)).toEqual([])
    expect(actual.checks[0]?.note).toContain('no checks are declared')
  },
)
