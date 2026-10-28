/**
 * The order Activity Runs are read in, and the reason it is not `seq`.
 *
 * `seq` is assigned `MAX(seq)+1` when a row is INSERTED. Under a concurrent
 * Stage two Activities start together and insert in whatever order they
 * happened to reach the database, so their `seq` values are distinct, stable
 * and meaningless as a sequence. Every list that sorted by it was stating
 * "this ran after that" on the strength of a race.
 *
 * Start time is what actually happened. `seq` survives only as the tiebreak
 * for two rows that start in the same millisecond, where it at least keeps
 * the order stable between renders.
 */

import { ts } from './format'
import type { ActivityRun } from './types'

/** Negative, zero or positive, as a comparator wants. */
export const byStart = (a: ActivityRun, b: ActivityRun): number => {
  const left = ts(a.started_at)
  const right = ts(b.started_at)
  const started =
    (Number.isFinite(left) ? left : Number.POSITIVE_INFINITY) -
    (Number.isFinite(right) ? right : Number.POSITIVE_INFINITY)

  return started === 0 ? (a.seq ?? 0) - (b.seq ?? 0) : started
}

/**
 * Whether `one` began after `other` had finished.
 *
 * The question "did this see what that produced" has a time answer and not a
 * sequence one. Two Activity Runs that overlapped saw each other's
 * half-finished work or none of it, and neither is "after".
 */
export const startedAfter = (one: ActivityRun, other: ActivityRun): boolean => {
  const start = ts(one.started_at)
  const end = ts(other.ended_at)

  return Number.isFinite(start) && Number.isFinite(end) && start >= end
}
