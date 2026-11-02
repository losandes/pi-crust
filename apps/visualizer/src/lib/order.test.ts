import { expect, test } from 'bun:test'
import { byStart, startedAfter } from './order'
import type { ActivityRun } from './types'

const activityRun = (
  id: string,
  seq: number,
  startedAt: string | null,
  endedAt: string | null,
): ActivityRun =>
  ({
    activity_run_id: id,
    name: id,
    kind: 'agent',
    owner: id,
    status: endedAt === null ? 'running' : 'success',
    seq,
    started_at: startedAt,
    ended_at: endedAt,
  }) as ActivityRun

test(
  [
    'given lib/order::byStart',
    'when two Activity Runs of a concurrent Stage inserted out of order',
    'it should read them by when they started, not by which row landed first',
  ].join(', '),
  () => {
    // given — `seq` is MAX(seq)+1 at INSERT, so a concurrent pair gets its
    // values from a race rather than from the run
    const review = activityRun('review', 9, '2026-01-01T00:00:01Z', null)
    const codeReview = activityRun(
      'code-review',
      8,
      '2026-01-01T00:00:02Z',
      null,
    )

    // when
    const actual = [codeReview, review].toSorted(byStart).map((one) => one.name)

    // then
    expect(actual).toEqual(['review', 'code-review'])
  },
)

test(
  [
    'given lib/order::byStart',
    'when two Activity Runs started in the same millisecond',
    'it should fall back to seq, so the order at least holds between renders',
  ].join(', '),
  () => {
    // given
    const first = activityRun('review', 4, '2026-01-01T00:00:00Z', null)
    const second = activityRun('code-review', 5, '2026-01-01T00:00:00Z', null)

    // when
    const actual = [second, first].toSorted(byStart).map((one) => one.name)

    // then
    expect(actual).toEqual(['review', 'code-review'])
  },
)

test(
  [
    'given lib/order::startedAfter',
    'when one Activity Run began before the other had finished',
    'it should be false, because overlapping is not after',
  ].join(', '),
  () => {
    // given — the `accept` Stage, running review and code-review together
    const review = activityRun(
      'review',
      1,
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:01:00Z',
    )
    const codeReview = activityRun(
      'code-review',
      2,
      '2026-01-01T00:00:05Z',
      '2026-01-01T00:00:55Z',
    )

    // when
    const actual = startedAfter(codeReview, review)

    // then — a higher seq would have said yes
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/order::startedAfter',
    'when one Activity Run began after the other ended',
    'it should be true, which is the only honest reading of downstream',
  ].join(', '),
  () => {
    // given
    const plan = activityRun(
      'plan',
      1,
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:01:00Z',
    )
    const build = activityRun('build', 2, '2026-01-01T00:02:00Z', null)

    // when
    const actual = startedAfter(build, plan)

    // then
    expect(actual).toBe(true)
  },
)
