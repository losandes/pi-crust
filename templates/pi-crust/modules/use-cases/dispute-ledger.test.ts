import { expect, test } from 'bun:test'
import type { TBuildOutput, TReviewOutput } from '../typedefs/envelope'
import { buildOutputSchema, reviewOutputSchema } from '../typedefs/envelope'
import { roundRecord, unmovedFindings, ledgerSchema} from './dispute-ledger'

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
  regress_to: { stage: '', because: '' },
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
    const actual = roundRecord({ round: 1, review, revise: undefined })

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
    const first = roundRecord({ round: 1, review: repeated, revise: undefined })
    const second = roundRecord({
      round: 2,
      review: repeated,
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
    const first = roundRecord({ round: 1, review: repeated, revise: undefined })
    const second = roundRecord({
      round: 2,
      review: review({
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
    const first = roundRecord({ round: 1, review: repeated, revise: undefined })
    const second = roundRecord({
      round: 2,
      review: repeated,
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
    const first = roundRecord({ round: 1, review: repeated, revise: undefined })
    const second = roundRecord({
      round: 2,
      review: repeated,
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
      { round: 1, blocking: ['x'], evidence: { x: 'src/a.ts:1' }, disputes: {}, changed: 2 },
    ]

    // when
    const actual = ledgerSchema.safeParse(current)

    // then
    expect(actual.success).toBe(true)
  },
)
