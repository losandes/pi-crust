/**
 * Waterfall geometry — where every block sits, and why.
 *
 * Lifted out of the component because none of it needs a DOM: it is arithmetic
 * over activityRuns and a time range, and arithmetic that decides what a reader
 * believes about a run deserves tests. Inside an SFC it had neither.
 */

import type { ActivityRun } from '@/domains/activity-runs'
import { ts } from '@/lib/format'

export type TRange = Readonly<{ t0: number; t1: number; span: number }>

export type TGeometry = Readonly<{ left: number; width: number }>

/**
 * The engineer's request opens the run and owns the start of the timeline: it
 * gets an exclusive leading zone, and every later activityRun maps into the rest, so
 * nothing can render on top of it.
 */
export const REQ_ZONE_PCT = 16

/** Below this a block is unreadable, so it is widened and its neighbours move. */
export const MIN_BLOCK_PCT = 3.5

export const timeRange = (
  activityRuns: readonly ActivityRun[],
  sessionStart: string | null | undefined,
  sessionEnd: string | null | undefined,
  running: boolean,
  nowMs: number,
): TRange => {
  const starts = [
    ts(sessionStart),
    ...activityRuns.map((p) => ts(p.started_at)),
  ].filter(Number.isFinite)
  const ends = [
    ts(sessionEnd),
    ...activityRuns.map((p) => ts(p.started_at)),
    ...activityRuns.map((p) => ts(p.ended_at)),
  ].filter(Number.isFinite)

  const t0 = starts.length > 0 ? Math.min(...starts) : nowMs
  const bounded = ends.length > 0 ? Math.max(...ends) : t0 + 1000
  const t1 = Math.max(running ? Math.max(bounded, nowMs) : bounded, t0 + 1000)
  return { t0, t1, span: t1 - t0 }
}

/**
 * Where the post-request timeline begins.
 *
 * The earliest non-engineer activityRun start, NOT the request activity-run's end: a later
 * lifecycle joining the session pushes the request row's ended_at forward, which
 * would otherwise throw every already-finished activityRun behind the origin.
 */
export const originMs = (
  activityRuns: readonly ActivityRun[],
  request: ActivityRun | undefined,
  range: TRange,
): number => {
  if (request === undefined) return range.t0
  const starts = activityRuns
    .filter((p) => p.kind !== 'engineer')
    .map((p) => ts(p.started_at))
    .filter(Number.isFinite)
  if (starts.length > 0) return Math.max(Math.min(...starts), range.t0)
  const end = ts(request.ended_at ?? request.started_at)
  return Number.isFinite(end) ? Math.max(end, range.t0) : range.t0
}

/**
 * Layout for every timed activityRun, in track-%.
 *
 * Every block sits where its own clock puts it. That is the whole rule, and
 * it is a correction: Activity Runs were sequential by doctrine, so a
 * near-zero block widened to the readable floor used to push every LATER
 * block right by the same amount, on the reasoning that two blocks must never
 * stack.
 *
 * A concurrent Stage breaks that reasoning. Two Activities that genuinely ran
 * at the same time would be shifted apart and read as one after the other —
 * the render inventing a sequence the run did not have, which is the one
 * thing a trace must never do. Lanes are per agent, so a concurrent pair is
 * drawn on different rows and overlapping is how the reader SEES it.
 *
 * What survives is the floor: a block narrower than `MIN_BLOCK_PCT` is widened
 * so it can be seen and clicked — but never past the start of the next block
 * in its OWN lane.
 *
 * That clamp is the second correction. A 26s Activity Run inside a 29-minute
 * run is 1.2% of the track, the floor is 3.5%, and the next Activity Run in
 * the same lane began 0.0s after it ended — so the floor drew one card over a
 * quarter of its successor. Touching says "adjacent" and is true; covering
 * says "concurrent" and is not. On the same chart a genuinely concurrent
 * pair sits at an identical offset, so a reader has no way to tell the
 * artefact from the fact.
 *
 * The clamp is per LANE because the same lane is the one place overlap cannot
 * be real: one agent does not run two Activity Runs at once. Two lanes
 * overlapping is concurrency, and is left alone.
 *
 * The layout is still normalised back into the track when the floors push the
 * last edge past it.
 */
export const blockLayout = (
  activityRuns: readonly ActivityRun[],
  options: Readonly<{
    zonePct: number
    originMs: number
    spanMs: number
    requestActivityRunId: string | undefined
    nowMs: number
  }>,
): Readonly<Record<string, TGeometry>> => {
  const available = 100 - options.zonePct - 0.4 // hair of right margin

  const timed = activityRuns
    .filter(
      (p) =>
        p.activity_run_id !== options.requestActivityRunId &&
        Number.isFinite(ts(p.started_at)),
    )
    .map((p) => {
      const start = ts(p.started_at)
      const ended = ts(p.ended_at)
      const end = Number.isFinite(ended)
        ? ended
        : p.status === 'running'
          ? options.nowMs
          : start
      return {
        id: p.activity_run_id,
        start,
        /*
         * The lane this block is drawn in, which is what the clamp is about.
         * `owner` for an agent; `kind` for the engineer and code rows, which
         * have none — mirroring how the chart builds its lanes.
         */
        lane: p.owner ?? p.kind ?? '',
        left: ((start - options.originMs) / options.spanMs) * available,
        width: ((Math.max(end, start) - start) / options.spanMs) * available,
      }
    })
    .toSorted((a, b) => a.start - b.start)

  /** Where the next block in the same lane begins, for every block. */
  const nextInLane = (block: (typeof timed)[number]): number | undefined =>
    timed.find(
      (other) => other.lane === block.lane && other.start > block.start,
    )?.left

  const rows = timed.map((block) => {
    const next = nextInLane(block)
    /*
     * Widen toward the floor, and no further than the neighbour's start. A
     * block always keeps its TRUE width — a clamp that cut one short would
     * be the same lie in the other direction.
     */
    const room =
      next === undefined ? MIN_BLOCK_PCT : Math.max(next - block.left, 0)

    return {
      id: block.id,
      left: block.left,
      width: Math.max(block.width, Math.min(MIN_BLOCK_PCT, room)),
    }
  })
  const edge = rows.reduce(
    (furthest, row) => Math.max(furthest, row.left + row.width),
    0,
  )

  const scale = available / Math.max(edge, available)
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      { left: options.zonePct + row.left * scale, width: row.width * scale },
    ]),
  )
}

export type TLaneContext = Readonly<{
  used: number
  window: number
  /** 0–100, uncapped by the floor applied to the bar's width. */
  pct: number
}>

/**
 * Occupancy for an agent lane. Undefined unless BOTH numbers are real — a bar
 * against an unknown ceiling would be decoration, not data.
 */
export const laneContext = (
  used: number | null | undefined,
  window: number | null | undefined,
): TLaneContext | undefined => {
  if (!(used && window)) return undefined
  return { used, window, pct: Math.min(100, (used / window) * 100) }
}

/** Sub-1% occupancy is common and real; round it away and the bar reads empty. */
export const contextLabel = (context: TLaneContext): string =>
  context.pct < 1 ? `${context.pct.toFixed(1)}%` : `${Math.round(context.pct)}%`

/** Keep a non-zero fill visible — the exact numbers ride in the label and title. */
export const contextFill = (context: TLaneContext): string =>
  `${Math.max(context.pct, 2)}%`

/**
 * Tool-call marks inside a block, positioned within the block's own span.
 *
 * Each mark carries the id of the event it came from. Position is NOT
 * identity: two calls a few milliseconds apart round to the same percentage,
 * and keying a list on that makes React treat distinct calls as one — it warns
 * about the duplicate and is free to drop either of them.
 */
export const toolTickPositions = (
  activityRun: ActivityRun,
  marks: readonly { id: string; t: number; ok: boolean }[],
  nowMs: number,
): readonly { id: string; x: number; ok: boolean }[] => {
  const start = ts(activityRun.started_at)
  if (!Number.isFinite(start)) return []
  const ended = ts(activityRun.ended_at)
  const end = Number.isFinite(ended)
    ? ended
    : activityRun.status === 'running'
      ? nowMs
      : start
  const width = Math.max(end - start, 1)
  return marks
    .filter((mark) => Number.isFinite(mark.t))
    .map((mark) => ({
      id: mark.id,
      x: Math.min(Math.max(((mark.t - start) / width) * 100, 1), 99),
      ok: mark.ok,
    }))
}
