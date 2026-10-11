/**
 * Waterfall geometry — where every block sits, and why.
 *
 * Lifted out of the component because none of it needs a DOM: it is arithmetic
 * over activityRuns and a time range, and arithmetic that decides what a reader
 * believes about a run deserves tests. Inside an SFC it had neither.
 */

import { ts } from './format'
import type { ActivityRun } from './types'

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
  const starts = [ts(sessionStart), ...activityRuns.map((p) => ts(p.started_at))].filter(
    Number.isFinite,
  )
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
 * Adjusted layout for every timed activityRun, in track-%.
 *
 * Activity Runs are sequential by doctrine and the render must say so: when a
 * near-zero activityRun (a git commit) is widened to a readable floor, every later
 * block shifts right by the same amount instead of being overlapped, and the
 * whole layout is normalised back into the track. Blocks may squeeze a hair;
 * they never stack.
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
        left: ((start - options.originMs) / options.spanMs) * available,
        width: ((Math.max(end, start) - start) / options.spanMs) * available,
      }
    })
    .toSorted((a, b) => a.start - b.start)

  let shift = 0
  let previousEdge = 0
  const rows: { id: string; left: number; width: number }[] = []
  for (const block of timed) {
    const pushed = block.left + shift
    const left = pushed < previousEdge ? previousEdge : pushed
    shift += left - pushed
    const width = Math.max(block.width, MIN_BLOCK_PCT)
    shift += width - block.width
    previousEdge = left + width
    rows.push({ id: block.id, left, width })
  }

  const scale = available / Math.max(previousEdge, available)
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
