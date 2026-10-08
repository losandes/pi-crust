import { expect, test } from 'bun:test'
import type { Phase } from './types'
import {
  MIN_BLOCK_PCT,
  blockLayout,
  contextLabel,
  laneContext,
  originMs,
  timeRange,
  toolTickPositions,
} from './waterfall'

const phase = (
  id: string,
  startedAt: string | null,
  endedAt: string | null,
  overrides: Partial<Phase> = {},
): Phase =>
  ({
    phase_id: id,
    name: id,
    kind: 'agent',
    owner: 'builder',
    status: endedAt === null ? 'running' : 'success',
    started_at: startedAt,
    ended_at: endedAt,
    seq: 0,
    ...overrides,
  }) as Phase

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString()

test(
  [
    'given lib/waterfall::blockLayout',
    'when a phase is too brief to see',
    'it should widen it to the floor and move its successors rather than overlap them',
  ].join(', '),
  () => {
    // given — a commit that took milliseconds, between two long phases
    const phases = [
      phase('build', at(0), at(60)),
      phase('commit', at(60), at(60)),
      phase('document', at(60), at(120)),
    ]

    // when
    const layout = blockLayout(phases, {
      zonePct: 0,
      originMs: Date.parse(at(0)),
      spanMs: 120_000,
      requestPhaseId: undefined,
      nowMs: Date.parse(at(120)),
    })

    // then — phases are sequential by doctrine and the render must say so
    const build = layout.build
    const commit = layout.commit
    const document = layout.document
    if (!(build && commit && document)) {
      throw new Error('every phase must be laid out')
    }
    expect(commit.width).toBeGreaterThanOrEqual(MIN_BLOCK_PCT * 0.9)
    expect(commit.left).toBeGreaterThanOrEqual(build.left + build.width - 0.001)
    expect(document.left).toBeGreaterThanOrEqual(commit.left + commit.width - 0.001)
  },
)

test(
  [
    'given lib/waterfall::blockLayout',
    'when widening pushes the last block past the track',
    'it should normalise the whole layout back inside it',
  ].join(', '),
  () => {
    // given — eight instantaneous phases, each demanding the floor
    const phases = Array.from({ length: 8 }, (_, index) =>
      phase(`p${index}`, at(index), at(index)),
    )

    // when
    const layout = blockLayout(phases, {
      zonePct: 0,
      originMs: Date.parse(at(0)),
      spanMs: 8000,
      requestPhaseId: undefined,
      nowMs: Date.parse(at(8)),
    })

    // then — 8 × 3.5% exceeds the track, so everything squeezes rather than
    // the tail running off the end
    const last = layout.p7
    if (!last) throw new Error('the last phase must be laid out')
    expect(last.left + last.width).toBeLessThanOrEqual(100)
  },
)

test(
  [
    'given lib/waterfall::originMs',
    'when a later run pushes the request phase\'s end forward',
    'it should start the timeline at the first real phase, not at that end',
  ].join(', '),
  () => {
    // given — the request row stays open across a second lifecycle joining the session
    const request = phase('request', at(0), at(600), {
      kind: 'engineer',
      owner: null,
    })
    const phases = [request, phase('plan', at(10), at(70))]
    const range = timeRange(phases, at(0), null, true, Date.parse(at(700)))

    // when
    const actual = originMs(phases, request, range)

    // then — otherwise every finished phase renders behind the origin
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
    'when a phase is still running',
    'it should measure marks against now rather than dropping them',
  ].join(', '),
  () => {
    // given
    const running = phase('build', at(0), null)
    const marks = [{ id: 'e1', t: Date.parse(at(30)), ok: true }]

    // when
    const actual = toolTickPositions(running, marks, Date.parse(at(60)))

    // then — halfway through a phase that has not ended yet
    expect(actual).toEqual([{ id: 'e1', x: 50, ok: true }])
  },
)
