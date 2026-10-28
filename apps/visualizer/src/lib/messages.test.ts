import { expect, test } from 'bun:test'
import {
  conversationOf,
  developerMessagesOf,
  stillPendingMessage,
} from './messages'
import type { TTurn } from './narration'
import type { EventRow } from './types'

const event = (overrides: Partial<EventRow>): EventRow =>
  ({
    event_id: Math.random().toString(36).slice(2),
    rowid: 1,
    started_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as EventRow

const inbox = (
  kind: 'steer' | 'follow_up' | 'abort',
  message: string,
  from = 'alice',
  at = '2026-01-01T00:00:00.000Z',
) =>
  event({
    type: 'log',
    name: `inbox_${kind}`,
    started_at: at,
    payload_json: JSON.stringify({ kind, message, from, at }),
  })

const standing = (text: string, at = '2026-01-01T00:00:00.000Z') =>
  event({
    type: 'log',
    name: 'steering_applied',
    started_at: at,
    payload_json: JSON.stringify({ agent: 'builder', text }),
  })

const turn = (n: number, at: string): TTurn => ({
  turn: n,
  at: new Date(at).getTime(),
  blocks: [],
  calls: [],
})

test(
  [
    'given lib/messages::developerMessagesOf',
    'when the trace carries a steer and a follow_up',
    'it should surface both',
  ].join(', '),
  () => {
    // given
    const events = [inbox('steer', 'stop and check the registry'), inbox('follow_up', 'also rename it')]

    // when
    const actual = developerMessagesOf(events)

    // then
    expect(actual.map((m) => m.kind)).toEqual(['steer', 'follow_up'])
    expect(actual.map((m) => m.text)).toEqual([
      'stop and check the registry',
      'also rename it',
    ])
  },
)

test(
  [
    'given lib/messages::developerMessagesOf',
    'when the trace carries an abort',
    'it should surface it too',
  ].join(', '),
  () => {
    // given
    const events = [inbox('abort', '')]

    // when
    const actual = developerMessagesOf(events)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.kind).toBe('abort')
  },
)

test(
  [
    'given lib/messages::developerMessagesOf',
    'when a steering block was applied to a prompt',
    "it should appear once, as a 'standing' message from 'you'",
  ].join(', '),
  () => {
    // given — this is what makes a standing instruction visible as having
    // actually reached the agent, not merely inferable from a prompts tab
    const events = [standing('use the registry, not the map')]

    // when
    const actual = developerMessagesOf(events)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]).toMatchObject({ kind: 'standing', from: 'you' })
    expect(actual[0]?.text).toBe('use the registry, not the map')
  },
)

test(
  [
    'given lib/messages::developerMessagesOf',
    'when an event is not one of the four shapes this reads',
    'it should skip it rather than guess',
  ].join(', '),
  () => {
    // given
    const events = [
      event({ type: 'narration', payload_json: '{}' }),
      event({ type: 'log', name: 'path_policy', payload_json: '{}' }),
    ]

    // when
    const actual = developerMessagesOf(events)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given lib/messages::conversationOf',
    'when a message was sent between two turns',
    'it should land between them',
  ].join(', '),
  () => {
    // given
    const turns = [turn(1, '2026-01-01T00:00:00.000Z'), turn(2, '2026-01-01T00:02:00.000Z')]
    const messages = developerMessagesOf([
      inbox('steer', 'mid-turn note', 'alice', '2026-01-01T00:01:00.000Z'),
    ])

    // when
    const actual = conversationOf(turns, messages)

    // then
    expect(actual.map((item) => item.kind)).toEqual(['turn', 'message', 'turn'])
  },
)

test(
  [
    'given lib/messages::conversationOf',
    'when a message is older than every turn',
    'it should sort first',
  ].join(', '),
  () => {
    // given
    const turns = [turn(1, '2026-01-01T00:05:00.000Z')]
    const messages = developerMessagesOf([
      standing('read this before you start', '2026-01-01T00:00:00.000Z'),
    ])

    // when
    const actual = conversationOf(turns, messages)

    // then
    expect(actual[0]?.kind).toBe('message')
  },
)

test(
  [
    'given lib/messages::stillPendingMessage',
    'when the matching text has arrived in the trace',
    'it should clear',
  ].join(', '),
  () => {
    // given
    const messages = developerMessagesOf([inbox('steer', 'use the registry')])

    // when
    const actual = stillPendingMessage({ kind: 'steer', text: 'use the registry' }, messages)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given lib/messages::stillPendingMessage',
    'when the trace carries a different message',
    'it should hold',
  ].join(', '),
  () => {
    // given
    const messages = developerMessagesOf([inbox('steer', 'something else')])

    // when
    const actual = stillPendingMessage({ kind: 'steer', text: 'use the registry' }, messages)

    // then
    expect(actual).toEqual({ kind: 'steer', text: 'use the registry' })
  },
)
