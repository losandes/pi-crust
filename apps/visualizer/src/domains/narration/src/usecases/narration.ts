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

import { safeParseSettlement, settledOr } from '@typedefs'
import type { EventRow } from '@/domains/events'
import { ts } from '@/lib/format'

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
  const raw = event.payload_json
  if (!raw) return {}
  const parsed = settledOr<unknown>(
    safeParseSettlement(() => JSON.parse(raw) as unknown),
    undefined,
  )
  return parsed !== null && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {}
}

const turnOf = (payload: Readonly<Record<string, unknown>>): number =>
  typeof payload.turn === 'number' ? payload.turn : 0

/**
 * Group a activity-run's events into turns.
 *
 * Events with no turn number collect under turn 0. `turnsOf` returns that
 * group; the chat tab shows it only when it holds narration (`narratedTurnsOf`).
 */
/**
 * One event's contribution to a turn, before the turns are assembled.
 *
 * Narration with no text contributes nothing, which is why it never reaches
 * here: a turn that would hold only empty text should not exist at all.
 */
type TTurnItem = Readonly<
  { turn: number; at: number } & (
    | { kind: 'block'; block: TNarrationBlock }
    | { kind: 'call'; call: TTurnCall }
  )
>

const itemsOf = (events: readonly EventRow[]): readonly TTurnItem[] =>
  events.flatMap((event): readonly TTurnItem[] => {
    const at = ts(event.started_at)
    const payload = payloadOf(event)

    if (event.type === 'narration') {
      const text = typeof payload.text === 'string' ? payload.text : ''
      if (text === '') return []
      return [
        {
          kind: 'block',
          turn: turnOf(payload),
          at,
          block: {
            id: event.event_id,
            channel: payload.channel === 'thinking' ? 'thinking' : 'text',
            text,
            at,
          },
        },
      ]
    }

    if (event.type !== 'tool_call') return []
    return [
      {
        kind: 'call',
        turn: turnOf(payload),
        at,
        call: {
          id: event.event_id,
          label: event.name ?? '',
          tool: typeof payload.tool === 'string' ? payload.tool : '',
          ok: payload.ok !== false,
          at,
          durationMs:
            typeof payload.duration_ms === 'number'
              ? payload.duration_ms
              : undefined,
        },
      },
    ]
  })

export const turnsOf = (events: readonly EventRow[]): readonly TTurn[] =>
  [...Map.groupBy(itemsOf(events), (item) => item.turn).entries()]
    .map(([turn, items]) => ({
      turn,
      // The turn is stamped by the first event that opened it, as the slot
      // this replaced was.
      at: items[0]?.at ?? 0,
      blocks: items.flatMap((item) =>
        item.kind === 'block' ? [item.block] : [],
      ),
      calls: items.flatMap((item) => (item.kind === 'call' ? [item.call] : [])),
    }))
    .filter((group) => group.blocks.length > 0 || group.calls.length > 0)
    .toSorted((a, b) => a.turn - b.turn || a.at - b.at)

/**
 * The turns the chat tab shows: those in which the agent narrated something.
 *
 * A turn that only called tools has nothing to read in the conversation; its
 * calls are in the events tab.
 */
export const narratedTurnsOf = (turns: readonly TTurn[]): readonly TTurn[] =>
  turns.filter((turn) => turn.blocks.length > 0)

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

/**
 * Whether a scroller has content beyond its frame.
 *
 * Scroll containment is applied only when this holds: on a scroller with
 * nothing to scroll, containment keeps the wheel from the page behind it.
 */
export const hasOverflow = (
  scrollHeight: number,
  clientHeight: number,
): boolean => scrollHeight > clientHeight

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

export const shouldOfferJump = (following: boolean, missed: number): boolean =>
  !following && missed >= JUMP_THRESHOLD
