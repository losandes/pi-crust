import { expect, test } from 'bun:test'
import type { TRoundRecord } from './dispute-ledger'
import { renderReport } from './dispute-report'
import {
  loopAgents,
  loopApplies,
  MAX_REVISE_ROUNDS,
  outcomeReason,
  trailingReview,
} from './revise-loop'

test(
  [
    'given use-cases/revise-loop::MAX_REVISE_ROUNDS',
    'when the bound is read',
    'it should be two, because a third round of an unsettled argument is worse value than escalating',
  ].join(', '),
  () => {
    // given
    const bound = MAX_REVISE_ROUNDS

    // when
    const actual = bound

    // then
    expect(actual).toEqual(2)
  },
)

test(
  [
    'given use-cases/revise-loop::trailingReview',
    'when a chain ends in a review step',
    'it should name that step, and name nothing for a chain that does not',
  ].join(', '),
  () => {
    // given
    const chains = [
      ['plan', 'build', 'review'],
      ['build', 'verify', 'code-review'],
      ['build', 'verify'],
      ['review', 'commit'],
    ]

    // when
    const actual = chains.map(trailingReview)

    // then
    expect(actual).toEqual(['review', 'code-review', '', ''])
  },
)

test(
  [
    'given use-cases/revise-loop::loopAgents',
    'when a chain ends in a review it never built for',
    'it should add the builder, so a roster without one fails before anything spawns',
  ].join(', '),
  () => {
    // given
    const chains = [['review'], ['build', 'verify']]

    // when
    const actual = chains.map(loopAgents)

    // then
    expect(actual).toEqual([['builder'], []])
    expect(loopApplies(['review'])).toEqual(true)
  },
)

test(
  [
    'given use-cases/revise-loop::outcomeReason',
    'when the loop deadlocked or ran out of rounds',
    'it should name the escalation file the developer has to read',
  ].join(', '),
  () => {
    // given
    const params = {
      unmoved: 2,
      reportPath: 'handoff/disputes.md',
      fallback: 'a step did not meet its own criterion',
    }

    // when
    const actual = [
      outcomeReason('deadlocked', params),
      outcomeReason('exhausted', params),
      outcomeReason('approved', params),
    ]

    // then
    expect(actual[0]).toEqual(
      'the review repeated 2 finding(s) the revise did not move, and neither ' +
        'side added evidence — see handoff/disputes.md',
    )
    expect(actual[1]).toEqual(
      'the reviewer never approved after 2 revise round(s) — see handoff/disputes.md',
    )
    expect(actual[2]).toEqual(params.fallback)
  },
)

test(
  [
    'given use-cases/revise-loop::renderReport',
    'when findings were left unresolved',
    'it should show what each side said in each round it was raised',
  ].join(', '),
  () => {
    // given
    const rounds: readonly TRoundRecord[] = [
      {
        round: 1,
        blocking: ['the handler is unguarded'],
        evidence: { 'the handler is unguarded': 'src/server.ts:42' },
        disputes: {},
        changed: 0,
      },
      {
        round: 2,
        blocking: ['the handler is unguarded'],
        evidence: { 'the handler is unguarded': 'src/server.ts:42' },
        disputes: { 'the handler is unguarded': 'src/server.ts:40' },
        changed: 0,
      },
    ]

    // when
    const actual = renderReport(rounds, ['the handler is unguarded'])

    // then
    expect(actual).toContain('## the handler is unguarded')
    expect(actual).toContain('round 1 — reviewer: src/server.ts:42')
    expect(actual).toContain('round 1 — builder: (not disputed)')
    expect(actual).toContain('round 2 — builder: src/server.ts:40')
  },
)
