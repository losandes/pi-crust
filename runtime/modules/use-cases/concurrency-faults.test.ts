import { expect, test } from 'bun:test'
import type { TAgentConfig } from '../typedefs/config'
import type { TLifecycleConfig } from '../typedefs/lifecycle'
import { concurrencyFaults, patternsOverlap } from './concurrency-faults'

const agent = (name: string, writes: readonly string[]): TAgentConfig =>
  ({ name, writes }) as unknown as TAgentConfig

const lifecycle = (
  strategy: 'serial' | 'concurrent',
  activities: readonly string[],
): TLifecycleConfig => ({
  name: 'sdlc',
  description: '',
  stages: [{ name: 'accept', strategy, activities: [...activities] }],
})

/** Every activity is performed by the agent of the same name, here. */
const performerOf = (activity: string): string => activity

test(
  [
    'given use-cases/concurrency-faults::concurrencyFaults',
    'when a concurrent stage runs two activities that write different files',
    'it should allow it, which is the one claim concurrency is allowed to make',
  ].join(', '),
  () => {
    // given
    const given = lifecycle('concurrent', ['review', 'code-review'])

    // when
    const actual = concurrencyFaults(
      given,
      [
        agent('review', ['{handoff}/review.md']),
        agent('code-review', ['{handoff}/code_review.md']),
      ],
      performerOf,
    )

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/concurrency-faults::concurrencyFaults',
    'when a concurrent stage runs two activities that write the same file',
    'it should refuse, naming both activities and the path they collide on',
  ].join(', '),
  () => {
    // given
    const given = lifecycle('concurrent', ['review', 'code-review'])

    // when
    const actual = concurrencyFaults(
      given,
      [
        agent('review', ['{handoff}/plan.md']),
        agent('code-review', ['{handoff}/plan.md']),
      ],
      performerOf,
    )

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.message).toContain("'review' and 'code-review'")
    expect(actual[0]?.message).toContain('{handoff}/plan.md')
  },
)

test(
  [
    'given use-cases/concurrency-faults::concurrencyFaults',
    'when an activity that may write anywhere is in a concurrent stage',
    'it should refuse, because a wildcard overlaps every other claim',
  ].join(', '),
  () => {
    // given
    const given = lifecycle('concurrent', ['build', 'review'])

    // when
    const actual = concurrencyFaults(
      given,
      [agent('build', ['*']), agent('review', ['{handoff}/review.md'])],
      performerOf,
    )

    // then
    expect(actual).toHaveLength(1)
  },
)

test(
  [
    'given use-cases/concurrency-faults::concurrencyFaults',
    'when the same overlapping activities sit in a serial stage',
    'it should allow it, because serially there is nothing to race',
  ].join(', '),
  () => {
    // given
    const given = lifecycle('serial', ['build', 'review'])

    // when
    const actual = concurrencyFaults(
      given,
      [agent('build', ['*']), agent('review', ['*'])],
      performerOf,
    )

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/concurrency-faults::patternsOverlap',
    'when one pattern is a directory containing the other',
    'it should overlap, because the narrower path is inside the wider one',
  ].join(', '),
  () => {
    // given
    const given = ['specs/', 'specs/plan.md']

    // when
    const actual = patternsOverlap(given[0] ?? '', given[1] ?? '')

    // then
    expect(actual).toEqual(true)
  },
)

test(
  [
    'given use-cases/concurrency-faults::patternsOverlap',
    'when two patterns name unrelated trees',
    'it should not overlap',
  ].join(', '),
  () => {
    // given
    const given = ['specs/', 'docs/']

    // when
    const actual = patternsOverlap(given[0] ?? '', given[1] ?? '')

    // then
    expect(actual).toEqual(false)
  },
)
