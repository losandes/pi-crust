/**
 * What a person said to a run, shown where the conversation already is.
 *
 * A message sent to a live agent WAS delivered and considered — `inbox_steer`
 * through `deliverFromInbox` into `control.steer` — but nothing rendered it,
 * so debugging the inbox found nothing wrong because nothing was wrong there.
 * `turnsOf` reads only `narration` and `tool_call`; this reads the events a
 * person's own words land under, and keeps them out of `turnsOf`'s shape so
 * they are never styled as the agent's own thinking.
 */

import { ts } from './format'
import type { TTurn } from './narration'
import type { EventRow } from './types'

export type TDeveloperMessage = Readonly<{
  id: string
  kind: 'steer' | 'follow_up' | 'abort' | 'standing'
  from: string
  text: string
  at: number
}>

export type TConversationItem =
  | Readonly<{ kind: 'turn'; turn: TTurn }>
  | Readonly<{ kind: 'message'; message: TDeveloperMessage }>

const payloadOf = (event: EventRow): Readonly<Record<string, unknown>> => {
  if (!event.payload_json) return {}
  // biome-ignore lint/plugin/no-intermediate-try-catch: a malformed payload is this function's own answer — one dropped message, never a broken pane
  try {
    const parsed: unknown = JSON.parse(event.payload_json)
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (cause) {
    void cause
    return {}
  }
}

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/**
 * One entry per `inbox_steer`, `inbox_follow_up`, `inbox_abort` or
 * `steering_applied` log event \u2014 the four shapes a person's own words can
 * reach a run through. `steering_applied` has no sender of its own; it is
 * what an agent was actually given, so it is attributed to `'you'` and kept
 * apart as `'standing'` rather than folded into the other three.
 */
export const developerMessagesOf = (
  events: readonly EventRow[],
): readonly TDeveloperMessage[] =>
  events.flatMap((event): readonly TDeveloperMessage[] => {
    if (event.type !== 'log') return []
    const payload = payloadOf(event)
    if (event.name === 'steering_applied') {
      const text = str(payload.text)
      if (text === '') return []
      return [
        {
          id: event.event_id,
          kind: 'standing' as const,
          from: 'you',
          text,
          at: ts(event.started_at),
        },
      ]
    }
    const kind =
      event.name === 'inbox_steer'
        ? 'steer'
        : event.name === 'inbox_follow_up'
          ? 'follow_up'
          : event.name === 'inbox_abort'
            ? 'abort'
            : undefined
    if (kind === undefined) return []
    return [
      {
        id: event.event_id,
        kind,
        from: str(payload.from, 'a developer'),
        text: str(payload.message),
        at: ts(event.started_at),
      },
    ]
  })

/**
 * Turns and messages, interleaved by time.
 *
 * A message lands after the last turn whose own time is at or before it, so
 * one typed between turn 1 and turn 2 reads exactly where it was sent \u2014
 * and one older than every turn sorts first, which is what a standing
 * instruction read at the very start of a replayed activity should do.
 */
export const conversationOf = (
  turns: readonly TTurn[],
  messages: readonly TDeveloperMessage[],
): readonly TConversationItem[] => {
  const items: Array<TConversationItem & { at: number }> = [
    ...turns.map((turn) => ({ kind: 'turn' as const, turn, at: turn.at })),
    ...messages.map((message) => ({
      kind: 'message' as const,
      message,
      at: message.at,
    })),
  ]
  return items
    .map((item, index) => ({ item, index }))
    .toSorted((a, b) => a.item.at - b.item.at || a.index - b.index)
    .map(({ item }) => item)
}

/**
 * Whether an optimistic, not-yet-traced message is still unanswered.
 *
 * Matched on text, the same way `stillPending` already matches a consult:
 * the trace has no id for an entry that has not landed yet, so the only
 * thing the UI sent and the event that eventually arrives can agree on is
 * what was typed.
 */
export const stillPendingMessage = (
  pending: Readonly<{ kind: string; text: string }> | undefined,
  messages: readonly TDeveloperMessage[],
): Readonly<{ kind: string; text: string }> | undefined => {
  if (pending === undefined) return undefined
  const arrived = messages.some(
    (message) => message.kind === pending.kind && message.text === pending.text,
  )
  return arrived ? undefined : pending
}
