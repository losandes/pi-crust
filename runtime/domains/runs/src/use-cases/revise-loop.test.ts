import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  acceptedExcluding,
  activitiesFileSchema,
  crustConfigSchema,
  lifecyclesFileSchema,
  withoutTerminal,
} from '../../../../lib/contracts'
import type { TRoundRecord } from '../../../gates'
import { renderReport } from '../../../gates'
import {
  groupApproved,
  loopAgents,
  loopApplies,
  outcomeReason,
  reAskedInstances,
  reviewGroups,
  reviseName,
  reviserFor,
} from './revise-loop'

const cfg = crustConfigSchema.parse({
  activities: [
    {
      name: 'plan',
      output: 'planOutput',
      prompt_engineering: { system: 's.md', user: 'u.md' },
    },
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
    const actual = reviserFor(cfg, given, { members: ['review'], at: 3 })

    // then — the LAST writer, which is the work the review ruled on
    expect(actual?.name).toEqual('build')
  },
)

test(
  [
    'given use-cases/revise-loop::reviewGroups',
    'when a chain ends in an Activity nothing in this package names',
    'it should still be a review, because its registry entry declares one',
  ].join(', '),
  () => {
    // given
    /*
     * The loop used to compare the last name against a list in
     * TypeScript, so a team that named its reviewer anything else ended a
     * chain with no loop: the verdict was honoured and the findings never
     * reached the builder.
     */
    const given = ['plan', 'build', 'ux-review']

    // when
    const actual = reviewGroups(given, cfg)

    // then
    expect(actual).toEqual([{ members: ['ux-review'], at: 2 }])
    expect(loopApplies(given, cfg)).toEqual(true)
  },
)

test(
  [
    'given use-cases/revise-loop::reviewGroups',
    'when a chain has no review or has one before its last writer',
    'it should find only the group that actually judges',
  ].join(', '),
  () => {
    // given
    const chains = [
      ['build', 'test'],
      ['review', 'document'],
    ]

    // when
    const actual = chains.map((names) => reviewGroups(names, cfg))

    // then
    expect(actual).toEqual([[], [{ members: ['review'], at: 0 }]])
    expect(chains.map((names) => loopApplies(names, cfg))).toEqual([
      false,
      true,
    ])
  },
)

test(
  [
    'given use-cases/revise-loop::reviewGroups',
    'when a chain ends in a Stage of two reviewers',
    'it should name both, because both are re-asked and both are set aside',
  ].join(', '),
  () => {
    // given — the shipped `accept` Stage
    const given = ['plan', 'build', 'test', 'review', 'code-review']

    // when
    const actual = reviewGroups(given, cfg)

    // then
    expect(actual).toEqual([{ members: ['review', 'code-review'], at: 3 }])
  },
)

test(
  [
    'given use-cases/revise-loop::reviewGroups with acceptedExcluding',
    'when a review the loop never re-asks ruled against the work',
    'it should leave the run unaccepted rather than discard a live rejection',
  ].join(', '),
  () => {
    // given — settling one group must not discard another group's rejection
    const given = ['build', 'ux-review', 'build', 'code-review']
    const outcomes = [
      { activity: 'build', accepted: true },
      { activity: 'ux-review', accepted: false },
      { activity: 'code-review', accepted: true },
    ]

    // when
    const group = reviewGroups(given, cfg).at(-1)?.members ?? []
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
    const actual = reAskedInstances(
      given,
      reviewGroups(given, cfg)[0]?.members ?? [],
      1,
    )

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
    'when a chain opens with a review or has no review',
    'it should not invent a reviser from the registry',
  ].join(', '),
  () => {
    // given
    const chains = [['review'], ['build', 'test']]

    // when
    const actual = chains.map((names) => loopAgents(cfg, names))

    // then
    expect(actual).toEqual([[], []])
    expect(loopApplies(['review'], cfg)).toEqual(true)
  },
)

test(
  [
    'given use-cases/revise-loop::reviewGroups and reviserFor',
    'when the chain contains plan reviews and a later code review',
    'it should find each maximal group and its own preceding writer',
  ].join(', '),
  () => {
    // given
    const names = [
      'plan',
      'ux-review',
      'review',
      'build',
      'test',
      'code-review',
      'document',
    ]

    // when
    const groups = reviewGroups(names, cfg)
    const revisers = groups.map((group) => reviserFor(cfg, names, group)?.name)

    // then
    expect(groups).toEqual([
      { members: ['ux-review', 'review'], at: 1 },
      { members: ['code-review'], at: 5 },
    ])
    expect(revisers).toEqual(['plan', 'test'])
    expect(loopAgents(cfg, names)).toEqual(['plan', 'test'])
    expect(loopApplies(names, cfg)).toBe(true)
  },
)

test(
  [
    'given use-cases/revise-loop::loopAgents',
    'when several review groups revisit the same writer',
    'it should validate that writer only once',
  ].join(', '),
  () => {
    // given
    const names = ['plan', 'review', 'plan', 'code-review']

    // when
    const actual = loopAgents(cfg, names)

    // then
    expect(actual).toEqual(['plan'])
    expect(reviewGroups([], cfg)).toEqual([])
    expect(
      reviserFor(cfg, ['review'], { members: ['review'], at: 0 }),
    ).toBeUndefined()
    expect(reviseName({ name: 'plan', output: 'planOutput' }, false)).toBe(
      'revise-plan',
    )
    expect(reviseName({ name: 'plan', output: 'planOutput' }, true)).toBe(
      'revise-plan',
    )
    expect(reviseName({ name: 'plan', output: 'planOutput' }, false, 2)).toBe(
      'revise-plan_2',
    )
    expect(reviseName({ name: 'test', output: 'buildOutput' }, true)).toBe(
      'revise',
    )
  },
)

for (const { name, writer } of [
  { name: 'ship', writer: 'test' },
  { name: 'bugfix', writer: 'build' },
]) {
  test(
    [
      'given the shipped lifecycle and Activity registries',
      `when the accept group in ${name} resolves its reviser`,
      `it should select ${writer}, the writer immediately before that group`,
    ].join(', '),
    () => {
      // given
      const stamp = join(
        import.meta.dir,
        '../../../../../templates/stamp/config',
      )
      const registry = activitiesFileSchema.parse(
        Bun.YAML.parse(
          readFileSync(join(stamp, 'crust.activities.yaml'), 'utf8'),
        ),
      )
      const shipped = crustConfigSchema.parse({
        activities: registry.activities,
      })
      const lifecycle = lifecyclesFileSchema
        .parse(
          Bun.YAML.parse(
            readFileSync(join(stamp, 'crust.lifecycles.yaml'), 'utf8'),
          ),
        )
        .lifecycles.find((one) => one.name === name)
      const names = withoutTerminal(lifecycle?.stages ?? []).flatMap(
        (one) => one.activities,
      )

      // when
      const group = reviewGroups(names, shipped).at(-1)
      const actual =
        group === undefined ? undefined : reviserFor(shipped, names, group)

      // then
      expect(actual?.name).toBe(writer)
    },
  )
}

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
        reviewers: {
          'plan-readiness': ['the handler is unguarded'],
          'plan-comprehension': [],
        },
        blocking: ['the handler is unguarded'],
        evidence: { 'the handler is unguarded': 'src/server.ts:42' },
        disputes: {},
        changed: 0,
      },
      {
        round: 2,
        reviewers: {
          'plan-readiness': ['the handler is unguarded'],
          'plan-comprehension': [],
        },
        blocking: ['the handler is unguarded'],
        evidence: { 'the handler is unguarded': 'src/server.ts:42' },
        disputes: { 'the handler is unguarded': 'src/server.ts:40' },
        changed: 0,
      },
    ]

    // when
    const actual = renderReport(rounds, ['the handler is unguarded'])

    // then
    expect(actual).toContain('## Round 1 reviewers')
    expect(actual).toContain('## Round 2 reviewers')
    expect(actual).toContain('- plan-readiness: the handler is unguarded')
    expect(actual).toContain('- plan-comprehension: (nothing blocking)')
    expect(actual).toContain('## the handler is unguarded')
    expect(actual).toContain('round 1 — reviewer: src/server.ts:42')
    expect(actual).toContain('round 1 — builder: (not disputed)')
    expect(actual).toContain('round 2 — builder: src/server.ts:40')
  },
)
