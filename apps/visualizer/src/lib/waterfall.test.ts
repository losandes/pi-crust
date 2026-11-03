import { expect, test } from 'bun:test'
import type { ActivityRun } from './types'
import {
  blockLayout,
  contextLabel,
  laneContext,
  MIN_BLOCK_PCT,
  originMs,
  timeRange,
  toolTickPositions,
} from './waterfall'

const activityRun = (
  id: string,
  startedAt: string | null,
  endedAt: string | null,
  overrides: Partial<ActivityRun> = {},
): ActivityRun =>
  ({
    activity_run_id: id,
    name: id,
    kind: 'agent',
    owner: 'builder',
    status: endedAt === null ? 'running' : 'success',
    started_at: startedAt,
    ended_at: endedAt,
    seq: 0,
    ...overrides,
  }) as ActivityRun

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + seconds * 1000).toISOString()

test(
  [
    'given lib/waterfall::blockLayout',
    'when an activityRun is too brief to see',
    'it should widen it to the floor without moving anything else',
  ].join(', '),
  () => {
    // given — a commit that took milliseconds, between two long activityRuns
    const activityRuns = [
      activityRun('build', at(0), at(60)),
      activityRun('commit', at(60), at(60)),
      activityRun('document', at(60), at(120)),
    ]

    // when
    const layout = blockLayout(activityRuns, {
      zonePct: 0,
      originMs: Date.parse(at(0)),
      spanMs: 120_000,
      requestActivityRunId: undefined,
      nowMs: Date.parse(at(120)),
    })

    // then — the floor makes it clickable; `document` still starts when it
    // started, because nudging it right would be the render inventing time
    const commit = layout.commit
    const document = layout.document
    if (!(commit && document)) {
      throw new Error('every activityRun must be laid out')
    }
    expect(commit.width).toBeGreaterThanOrEqual(MIN_BLOCK_PCT * 0.9)
    // half the track, less the hair of right margin the layout reserves
    expect(document.left).toBeCloseTo(49.8, 1)
  },
)

test(
  [
    'given lib/waterfall::blockLayout',
    'when two activityRuns genuinely overlapped',
    'it should draw them overlapping rather than one after the other',
  ].join(', '),
  () => {
    // given — the `accept` Stage: review and code-review, concurrent, each in
    // its own lane because the lanes are per agent
    const activityRuns = [
      activityRun('review', at(0), at(60), { owner: 'review' }),
      activityRun('code-review', at(5), at(55), { owner: 'code-review' }),
    ]

    // when
    const layout = blockLayout(activityRuns, {
      zonePct: 0,
      originMs: Date.parse(at(0)),
      spanMs: 60_000,
      requestActivityRunId: undefined,
      nowMs: Date.parse(at(60)),
    })

    // then — the second starts INSIDE the first, which is what happened
    const review = layout.review
    const code = layout['code-review']
    if (!(review && code)) throw new Error('every activityRun must be laid out')
    expect(code.left).toBeLessThan(review.left + review.width)
    expect(code.left + code.width).toBeLessThanOrEqual(
      review.left + review.width + 0.001,
    )
  },
)

test(
  [
    'given lib/waterfall::blockLayout',
    'when widening pushes the last block past the track',
    'it should normalise the whole layout back inside it',
  ].join(', '),
  () => {
    // given — eight instantaneous activityRuns, each demanding the floor
    const activityRuns = Array.from({ length: 8 }, (_, index) =>
      activityRun(`p${index}`, at(index), at(index)),
    )

    // when
    const layout = blockLayout(activityRuns, {
      zonePct: 0,
      originMs: Date.parse(at(0)),
      spanMs: 8000,
      requestActivityRunId: undefined,
      nowMs: Date.parse(at(8)),
    })

    // then — 8 × 3.5% exceeds the track, so everything squeezes rather than
    // the tail running off the end
    const last = layout.p7
    if (!last) throw new Error('the last activityRun must be laid out')
    expect(last.left + last.width).toBeLessThanOrEqual(100)
  },
)

test(
  [
    'given lib/waterfall::originMs',
    "when a later run pushes the request activityRun's end forward",
    'it should start the timeline at the first real activityRun, not at that end',
  ].join(', '),
  () => {
    // given — the request row stays open across a second lifecycle joining the session
    const request = activityRun('request', at(0), at(600), {
      kind: 'engineer',
      owner: null,
    })
    const activityRuns = [request, activityRun('plan', at(10), at(70))]
    const range = timeRange(
      activityRuns,
      at(0),
      null,
      true,
      Date.parse(at(700)),
    )

    // when
    const actual = originMs(activityRuns, request, range)

    // then — otherwise every finished activityRun renders behind the origin
    expect(actual).toBe(Date.parse(at(10)))
  },
)

test(
  [
    'given lib/waterfall::laneContext',
    'when the context window is unknown',
    'it should yield nothing rather than a bar against an invented ceiling',
  ].join(', '),
  () => {
    // given
    const used = 42_000

    // when
    const actual = laneContext(used, undefined)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given lib/waterfall::contextLabel',
    'when occupancy is a fraction of a percent',
    'it should keep a decimal so the bar does not read as empty',
  ].join(', '),
  () => {
    // given — 2k of a 1M window is real and common
    const context = laneContext(2000, 1_000_000)
    if (context === undefined) throw new Error('both numbers are real here')

    // when
    const actual = contextLabel(context)

    // then
    expect(actual).toBe('0.2%')
  },
)

test(
  [
    'given lib/waterfall::toolTickPositions',
    'when a activityRun is still running',
    'it should measure marks against now rather than dropping them',
  ].join(', '),
  () => {
    // given
    const running = activityRun('build', at(0), null)
    const marks = [{ id: 'e1', t: Date.parse(at(30)), ok: true }]

    // when
    const actual = toolTickPositions(running, marks, Date.parse(at(60)))

    // then — halfway through a activityRun that has not ended yet
    expect(actual).toEqual([{ id: 'e1', x: 50, ok: true }])
  },
)

test(
  [
    'given lib/waterfall::blockLayout',
    'when a short activityRun abuts a later one in the SAME lane',
    'it should not widen over it, because one agent cannot run two at once',
  ].join(', '),
  () => {
    // given — the numbers from a real run: build ran 26.1s, build again ran
    // 104.4s starting 0.0s later, inside a 1769s span. 26.1s is 1.2% of the
    // track and the floor is 3.5%, so the floor alone drew the first card
    // over a quarter of the second.
    const span = 1769_000
    const activityRuns = [
      activityRun('build_1', at(0), at(26.1), { owner: 'build' }),
      activityRun('build_2', at(26.1), at(130.5), { owner: 'build' }),
    ]

    // when
    const layout = blockLayout(activityRuns, {
      zonePct: 16,
      originMs: Date.parse(at(0)),
      spanMs: span,
      requestActivityRunId: undefined,
      nowMs: Date.parse(at(1769)),
    })

    // then — adjacent, never covering
    const first = layout.build_1
    const second = layout.build_2
    if (!(first && second))
      throw new Error('every activityRun must be laid out')
    expect(first.left + first.width).toBeLessThanOrEqual(second.left + 0.001)
  },
)

test(
  [
    'given lib/waterfall::blockLayout',
    'when a short activityRun has no successor in its lane',
    'it should still get the floor, which is what makes it clickable',
  ].join(', '),
  () => {
    // given — the clamp must not cost every short block its readable width
    const activityRuns = [
      activityRun('commit', at(0), at(0.2), { owner: 'build' }),
    ]

    // when
    const layout = blockLayout(activityRuns, {
      zonePct: 16,
      originMs: Date.parse(at(0)),
      spanMs: 1769_000,
      requestActivityRunId: undefined,
      nowMs: Date.parse(at(1769)),
    })

    // then
    const commit = layout.commit
    if (!commit) throw new Error('the activityRun must be laid out')
    expect(commit.width).toBeGreaterThanOrEqual(MIN_BLOCK_PCT * 0.9)
  },
)

test(
  [
    'given lib/waterfall::blockLayout',
    'when a short activityRun abuts a later one in a DIFFERENT lane',
    'it should keep the floor, because other lanes are where overlap is real',
  ].join(', '),
  () => {
    // given — the clamp is per lane; clamping across lanes would shrink a
    // block to avoid an overlap that means something
    const activityRuns = [
      activityRun('build', at(0), at(26.1), { owner: 'build' }),
      activityRun('test', at(26.1), at(130.5), { owner: 'test' }),
    ]

    // when
    const layout = blockLayout(activityRuns, {
      zonePct: 16,
      originMs: Date.parse(at(0)),
      spanMs: 1769_000,
      requestActivityRunId: undefined,
      nowMs: Date.parse(at(1769)),
    })

    // then
    const build = layout.build
    if (!build) throw new Error('the activityRun must be laid out')
    expect(build.width).toBeGreaterThanOrEqual(MIN_BLOCK_PCT * 0.9)
  },
)
