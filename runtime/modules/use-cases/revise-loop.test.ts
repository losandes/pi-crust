import { expect, test } from 'bun:test'
import type { TRoundRecord } from './dispute-ledger'
import { renderReport } from './dispute-report'
import { crustConfigSchema } from '../typedefs/config'
import {
  loopAgents,
  loopApplies,
  outcomeReason,
  reviserFor,
  trailingReview,
} from './revise-loop'

const cfg = crustConfigSchema.parse({
  activities: [
    {
      name: 'build',
      output: 'buildOutput',
      purpose: 'Implement the plan and report every changed file',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    },
    {
      name: 'test',
      output: 'buildOutput',
      purpose: 'Write the tests that would prove the request was implemented',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    },
    {
      name: 'review',
      output: 'reviewOutput',
      purpose: 'Confirm that what was built is what was asked for',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    },
  ],
})

test(
  [
    'given use-cases/revise-loop::reviserFor',
    'when a chain wrote something before it was reviewed',
    'it should revise with the Activity that wrote it, not with a registry entry of its own',
  ].join(', '),
  () => {
    // given — `revise` left the registry: no Lifecycle names it, and an
    // entry nothing can name is an entry that drifts
    const given = ['plan', 'test', 'build', 'review']

    // when
    const actual = reviserFor(cfg, given)

    // then — the LAST writer, which is the work the review ruled on
    expect(actual?.name).toEqual('build')
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
      ['build', 'test', 'code-review'],
      ['build', 'test'],
      ['review', 'document'],
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
    'it should add the reviser, so a roster without one fails before anything spawns',
  ].join(', '),
  () => {
    // given
    const chains = [['review'], ['build', 'test']]

    // when
    const actual = chains.map((names) => loopAgents(cfg, names))

    // then
    expect(actual).toEqual([['build'], []])
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
      'the reviewer never approved, and the revising activity has no ' +
        'attempts left — see handoff/disputes.md',
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
