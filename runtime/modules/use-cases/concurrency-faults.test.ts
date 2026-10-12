import { expect, test } from 'bun:test'
import type { TActivityConfig } from '../typedefs/activity'
import type { TLifecycleConfig } from '../typedefs/lifecycle'
import { concurrencyFaults, patternsOverlap } from './concurrency-faults'

const activityWriting = (
  name: string,
  writes: readonly string[],
): TActivityConfig => ({ name, writes }) as unknown as TActivityConfig

const lifecycle = (
  strategy: 'serial' | 'concurrent',
  activities: readonly string[],
): TLifecycleConfig => ({
  name: 'sdlc',
  description: '',
  stages: [{ name: 'accept', strategy, activities: [...activities] }],
})

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
        activityWriting('review', ['{handoff}/review.md']),
        activityWriting('code-review', ['{handoff}/code_review.md']),
      ],
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
        activityWriting('review', ['{handoff}/plan.md']),
        activityWriting('code-review', ['{handoff}/plan.md']),
      ],
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
      [activityWriting('build', ['*']), activityWriting('review', ['{handoff}/review.md'])],
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
      [activityWriting('build', ['*']), activityWriting('review', ['*'])],
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
