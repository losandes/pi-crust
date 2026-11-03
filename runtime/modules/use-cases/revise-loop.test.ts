import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../typedefs/config'
import { acceptedExcluding } from '../typedefs/runnable-activity'
import type { TRoundRecord } from './dispute-ledger'
import { renderReport } from './dispute-report'
import {
  groupApproved,
  loopAgents,
  loopApplies,
  outcomeReason,
  reAskedInstances,
  reviserFor,
  trailingReviews,
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
    {
      name: 'code-review',
      output: 'reviewOutput',
      purpose:
        'Judge the change against the conventions this repository ratified',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    },
    /*
     * A reviewer this package has never heard of, which is the whole point:
     * what makes an Activity a review is the contract it declares, and a
     * team names its own Activities.
     */
    {
      name: 'ux-review',
      output: 'reviewOutput',
      purpose: 'Rule on whether the interface does what the spec described',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    },
    {
      name: 'document',
      output: 'buildOutput',
      purpose: 'Write up the change for the people who did not run it',
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
    'given use-cases/revise-loop::trailingReviews',
    'when a chain ends in an Activity nothing in this package names',
    'it should still be a review, because its registry entry declares one',
  ].join(', '),
  () => {
    /*
     * given — the loop used to compare the last name against a list in
     * TypeScript, so a team that named its reviewer anything else ended a
     * chain with no loop: the verdict was honoured and the findings never
     * reached the builder.
     */
    const given = ['plan', 'build', 'ux-review']

    // when
    const actual = trailingReviews(given, cfg)

    // then
    expect(actual).toEqual(['ux-review'])
    expect(loopApplies(given, cfg)).toEqual(true)
  },
)

test(
  [
    'given use-cases/revise-loop::trailingReviews',
    'when a chain ends in an Activity that writes rather than judges',
    'it should name no review, which is what settles the loop as not-applicable',
  ].join(', '),
  () => {
    // given
    const chains = [
      ['build', 'test'],
      ['review', 'document'],
    ]

    // when
    const actual = chains.map((names) => trailingReviews(names, cfg))

    // then
    expect(actual).toEqual([[], []])
    expect(chains.map((names) => loopApplies(names, cfg))).toEqual([
      false,
      false,
    ])
  },
)

test(
  [
    'given use-cases/revise-loop::trailingReviews',
    'when a chain ends in a Stage of two reviewers',
    'it should name both, because both are re-asked and both are set aside',
  ].join(', '),
  () => {
    // given — the shipped `accept` Stage
    const given = ['plan', 'build', 'test', 'review', 'code-review']

    // when
    const actual = trailingReviews(given, cfg)

    // then
    expect(actual).toEqual(['review', 'code-review'])
  },
)

test(
  [
    'given use-cases/revise-loop::trailingReviews with acceptedExcluding',
    'when a review the loop never re-asks ruled against the work',
    'it should leave the run unaccepted rather than discard a live rejection',
  ].join(', '),
  () => {
    /*
     * given — a chain that reviewed, built again, and reviewed again. Only
     * the trailing review is re-asked, so the earlier rejection belongs to
     * nobody's next round and must stay decisive. Excluding it by NAME is
     * how a run came back green over a reviewer still saying no.
     */
    const given = ['build', 'ux-review', 'build', 'code-review']
    const outcomes = [
      { activity: 'build', accepted: true },
      { activity: 'ux-review', accepted: false },
      { activity: 'code-review', accepted: true },
    ]

    // when
    const group = trailingReviews(given, cfg)
    const actual = acceptedExcluding(outcomes, group)

    // then
    expect(group).toEqual(['code-review'])
    expect(actual).toEqual(false)
  },
)

test(
  [
    'given use-cases/revise-loop::reAskedInstances',
    'when a round re-asks a trailing Stage of two reviewers',
    'it should re-ask both, each numbered past what the chain already spent',
  ].join(', '),
  () => {
    // given
    const given = ['build', 'review', 'code-review']

    // when
    const actual = reAskedInstances(given, trailingReviews(given, cfg), 1)

    // then — `review_2` and `code-review_2`, so each round is its own
    // Activity Run rather than a second one sharing an instance
    expect(actual).toEqual([
      { name: 'review', instance: 2 },
      { name: 'code-review', instance: 2 },
    ])
  },
)

test(
  [
    'given use-cases/revise-loop::groupApproved',
    'when one reviewer of a trailing Stage approved and the other did not',
    'it should not count as approved, so the round runs again',
  ].join(', '),
  () => {
    // given
    const given = [
      { activity: 'build', accepted: true },
      { activity: 'review', accepted: false },
      { activity: 'code-review', accepted: true },
    ]

    // when
    const actual = [
      groupApproved(given, ['review', 'code-review']),
      groupApproved(given, ['code-review']),
    ]

    // then
    expect(actual).toEqual([false, true])
  },
)

test(
  [
    'given use-cases/revise-loop::groupApproved',
    'when a reviewer was re-asked and approved the second time',
    'it should read the latest outcome, not the verdict the round answered',
  ].join(', '),
  () => {
    // given
    const given = [
      { activity: 'code-review', accepted: false },
      { activity: 'revise', accepted: true },
      { activity: 'code-review', accepted: true },
    ]

    // when
    const actual = groupApproved(given, ['code-review'])

    // then
    expect(actual).toEqual(true)
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
    expect(loopApplies(['review'], cfg)).toEqual(true)
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
      fallback: 'a activity did not meet its own criterion',
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
