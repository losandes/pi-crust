import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TBuildOutput,
  TReviewOutput,
  TRun,
} from '../../../../lib/contracts'
import {
  buildOutputSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import type { TRoundRecord } from './dispute-ledger'
import {
  ledgerPath,
  ledgerSchema,
  readLedger,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from './dispute-ledger'

const runWith = (contextHandoffDir: string, notes: string[]): TRun =>
  ({
    contextHandoffDir,
    console: {
      // biome-ignore lint/plugin/no-array-mutation: recording what was noted is the test
      note: (message: string) => notes.push(message),
    },
  }) as unknown as TRun

/**
 * The six context fields every agent envelope now carries.
 *
 * Empty here on purpose: these tests are about the ledger's counting, and a
 * fixture that fills them in would suggest the counting reads them. It does
 * not — it reads `blocking`, `findings` and `disputes`.
 */
const context = {
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

const review = (fields: Readonly<Record<string, unknown>>): TReviewOutput =>
  reviewOutputSchema.parse({ status: 'success', ...context, ...fields })

const revise = (fields: Readonly<Record<string, unknown>>): TBuildOutput =>
  buildOutputSchema.parse({ status: 'success', ...context, ...fields })

const repeated = review({
  approved: false,
  blocking: ['The handler is unguarded.'],
  findings: [
    {
      requirement: 'the handler is unguarded',
      met: false,
      evidence: 'src/server.ts:42',
    },
  ],
})

test(
  [
    'given use-cases/dispute-ledger::roundRecord',
    'when the reviewer blocks on a finding it also evidenced',
    'it should key the evidence by the normalised blocking item',
  ].join(', '),
  () => {
    // given
    const review = repeated

    // when
    const actual = roundRecord({
      round: 1,
      reviews: [review],
      revise: undefined,
    })

    // then
    expect(actual.blocking).toEqual(['the handler is unguarded'])
    expect(actual.evidence).toEqual({
      'the handler is unguarded': 'src/server.ts:42',
    })
    expect(actual.changed).toEqual(0)
  },
)

test(
  [
    'given use-cases/dispute-ledger::unmovedFindings',
    'when the review repeats itself and the revise neither changed nor argued',
    'it should report the finding as unmoved',
  ].join(', '),
  () => {
    // given
    const first = roundRecord({
      round: 1,
      reviews: [repeated],
      revise: undefined,
    })
    const second = roundRecord({
      round: 2,
      reviews: [repeated],
      revise: revise({ changed_files: [] }),
    })

    // when
    const actual = unmovedFindings(first, second)

    // then
    expect(actual).toEqual(['the handler is unguarded'])
  },
)

test(
  [
    'given use-cases/dispute-ledger::unmovedFindings',
    'when the reviewer restated the finding with new evidence',
    'it should report nothing unmoved, because the reviewer moved',
  ].join(', '),
  () => {
    // given
    const first = roundRecord({
      round: 1,
      reviews: [repeated],
      revise: undefined,
    })
    const second = roundRecord({
      round: 2,
      reviews: [
        review({
          approved: false,
          blocking: ['The handler is unguarded.'],
          findings: [
            {
              requirement: 'the handler is unguarded',
              met: false,
              evidence: 'src/server.ts:91',
            },
          ],
        }),
      ],
      revise: revise({ changed_files: [] }),
    })

    // when
    const actual = unmovedFindings(first, second)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/dispute-ledger::unmovedFindings',
    'when the revise disputed the finding with evidence it had not given before',
    'it should report nothing unmoved, because the builder moved',
  ].join(', '),
  () => {
    // given
    const first = roundRecord({
      round: 1,
      reviews: [repeated],
      revise: undefined,
    })
    const second = roundRecord({
      round: 2,
      reviews: [repeated],
      revise: revise({
        changed_files: [],
        disputes: [
          {
            finding: 'the handler is unguarded',
            evidence: 'src/server.ts:40 guards it one frame up',
          },
        ],
      }),
    })

    // when
    const actual = unmovedFindings(first, second)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/dispute-ledger::unmovedFindings',
    'when the revise changed a file without arguing',
    'it should report nothing unmoved, because editing code is an answer too',
  ].join(', '),
  () => {
    // given
    const first = roundRecord({
      round: 1,
      reviews: [repeated],
      revise: undefined,
    })
    const second = roundRecord({
      round: 2,
      reviews: [repeated],
      revise: revise({ changed_files: ['src/server.ts'] }),
    })

    // when
    const actual = unmovedFindings(first, second)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/dispute-ledger::ledgerSchema',
    'when a persisted ledger holds a record from another shape',
    'it should refuse to parse rather than be trusted on resume',
  ].join(', '),
  () => {
    // given a record an older writer might have left
    const stale = [{ round: 1, blocking: ['x'] }]

    // when
    const actual = ledgerSchema.safeParse(stale)

    // then — this file decides deadlock and escalation; a half-record must not
    expect(actual.success).toBe(false)
  },
)

test(
  [
    'given use-cases/dispute-ledger::ledgerSchema',
    'when the ledger is what this version writes',
    'it should parse',
  ].join(', '),
  () => {
    // given
    const current = [
      {
        round: 1,
        blocking: ['x'],
        evidence: { x: 'src/a.ts:1' },
        disputes: {},
        changed: 2,
      },
    ]

    // when
    const actual = ledgerSchema.safeParse(current)

    // then
    expect(actual.success).toBe(true)
  },
)

test(
  [
    'given use-cases/dispute-ledger::readLedger',
    'when no ledger file exists yet',
    'it should answer an empty ledger, with no note',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-dispute-ledger-none-'))
    const notes: string[] = []
    const run = runWith(dir, notes)

    // when
    const actual = readLedger(run)

    // then
    expect(actual).toEqual([])
    expect(notes).toEqual([])
  },
)

test(
  [
    'given use-cases/dispute-ledger::writeLedger, readLedger',
    'when a ledger is written and read back',
    'it should round-trip every round exactly',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-dispute-ledger-roundtrip-'))
    const notes: string[] = []
    const run = runWith(dir, notes)
    const rounds: readonly TRoundRecord[] = [
      {
        round: 1,
        blocking: ['the handler is unguarded'],
        evidence: { 'the handler is unguarded': 'src/server.ts:42' },
        disputes: {},
        changed: 2,
      },
    ]

    // when
    writeLedger(run, rounds)
    const actual = readLedger(run)

    // then
    expect(actual).toEqual(rounds)
  },
)

test(
  [
    'given use-cases/dispute-ledger::readLedger',
    'when the ledger on disk does not parse',
    'it should treat it as absent and note why, rather than throw',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-dispute-ledger-corrupt-'))
    writeFileSync(join(dir, 'disputes.json'), 'not json at all')
    const notes: string[] = []
    const run = runWith(dir, notes)

    // when
    const actual = readLedger(run)

    // then
    expect(actual).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('ignoring an unreadable dispute ledger')
  },
)

test(
  [
    'given use-cases/dispute-ledger::ledgerPath',
    'when asked where a run keeps its ledger',
    'it should resolve under the run\u2019s own context_handoff directory',
  ].join(', '),
  () => {
    // given
    const run = runWith('/tmp/crust-handoff', [])

    // when
    const actual = ledgerPath(run)

    // then
    expect(actual).toEqual(join('/tmp/crust-handoff', 'disputes.json'))
  },
)
