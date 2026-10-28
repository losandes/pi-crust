/**
 * Turning a activityRun's events into something readable.
 *
 * The narration is the content; the tool calls are the footnotes. The trace
 * stores them as one interleaved stream because that is the order they
 * happened in, but nobody reads them that way — a reader follows the thinking
 * and dips into a call only when the thinking makes them want to.
 *
 * So the stream is regrouped by TURN: everything an agent said in one turn,
 * beside every call that turn made. The turn id comes from the tracer rather
 * than from timestamps, because two agents' events interleave and adjacency in
 * time is not causation.
 */

import { ts } from './format'
import type { EventRow } from './types'

export type TNarrationBlock = Readonly<{
  id: string
  channel: 'thinking' | 'text'
  text: string
  at: number
}>

export type TTurnCall = Readonly<{
  id: string
  label: string
  tool: string
  ok: boolean
  at: number
  durationMs: number | undefined
}>

export type TTurn = Readonly<{
  turn: number
  blocks: readonly TNarrationBlock[]
  calls: readonly TTurnCall[]
  at: number
}>

const payloadOf = (event: EventRow): Readonly<Record<string, unknown>> => {
  if (!event.payload_json) return {}
  try {
    const parsed: unknown = JSON.parse(event.payload_json)
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const turnOf = (payload: Readonly<Record<string, unknown>>): number =>
  typeof payload.turn === 'number' ? payload.turn : 0

/**
 * Group a activity-run's events into turns.
 *
 * Events whose turn is unknown — every run traced before narration existed —
 * collect under turn 0, which the pane renders as a single untitled group
 * rather than dropping. An old run should still show its tool calls.
 */
export const turnsOf = (events: readonly EventRow[]): readonly TTurn[] => {
  const byTurn = new Map<number, { blocks: TNarrationBlock[]; calls: TTurnCall[]; at: number }>()

  const slot = (turn: number, at: number) => {
    const existing = byTurn.get(turn)
    if (existing !== undefined) {
      return existing
    }
    const created = { blocks: [], calls: [], at }
    byTurn.set(turn, created)
    return created
  }

  for (const event of events) {
    const at = ts(event.started_at)
    const payload = payloadOf(event)

    if (event.type === 'narration') {
      const turn = turnOf(payload)
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (text === '') continue
      slot(turn, at).blocks.push({
        id: event.event_id,
        channel: payload.channel === 'thinking' ? 'thinking' : 'text',
        text,
        at,
      })
      continue
    }

    if (event.type === 'tool_call') {
      const turn = turnOf(payload)
      slot(turn, at).calls.push({
        id: event.event_id,
        label: event.name ?? '',
        tool: typeof payload.tool === 'string' ? payload.tool : '',
        ok: payload.ok !== false,
        at,
        durationMs:
          typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined,
      })
    }
  }

  return [...byTurn.entries()]
    .map(([turn, group]) => ({ turn, ...group }))
    .filter((group) => group.blocks.length > 0 || group.calls.length > 0)
    .toSorted((a, b) => a.turn - b.turn || a.at - b.at)
}

/**
 * Whether the view should stay pinned to the newest message.
 *
 * Following by default, and stopping the moment a reader scrolls away, is the
 * entire point of the pane: a tool call that emits fifty lines must not drag
 * away the sentence someone is mid-way through. Returning to the bottom
 * resumes following, with no affordance to click.
 *
 * The slack exists because a browser's scroll arithmetic is fractional — an
 * exact comparison reports "not at the bottom" for a view that visibly is.
 */
export const AT_BOTTOM_SLACK_PX = 24

export const isAtBottom = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean => scrollHeight - (scrollTop + clientHeight) <= AT_BOTTOM_SLACK_PX

/**
 * How far behind a reader has to fall before being offered a shortcut back.
 *
 * Not on the first message that arrives while they read — that is a button
 * flickering in and out of a page they are trying to concentrate on. It
 * appears when scrolling back by hand would itself be the annoyance.
 */
export const JUMP_THRESHOLD = 8

export const shouldOfferJump = (
  following: boolean,
  missed: number,
): boolean => !following && missed >= JUMP_THRESHOLD
