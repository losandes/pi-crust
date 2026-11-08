import { expect, test } from 'bun:test'
import type { EventRow } from '@/domains/events'
import {
  isAtBottom,
  JUMP_THRESHOLD,
  shouldOfferJump,
  turnsOf,
} from './narration'

const event = (overrides: Partial<EventRow>): EventRow =>
  ({
    event_id: Math.random().toString(36).slice(2),
    rowid: 1,
    started_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as EventRow

const narration = (turn: number, text: string, channel = 'thinking') =>
  event({
    type: 'narration',
    payload_json: JSON.stringify({ turn, channel, text }),
  })

const call = (turn: number, label: string, ok = true) =>
  event({
    type: 'tool_call',
    name: label,
    payload_json: JSON.stringify({ turn, tool: label.split(':')[0], ok }),
  })

test(
  [
    'given lib/narration::turnsOf',
    'when thinking and the calls it caused share a turn',
    'it should group them, rather than interleaving them in trace order',
  ].join(', '),
  () => {
    // given — the trace stores one stream; nobody reads it that way
    const events = [
      narration(1, 'I should look at the config'),
      call(1, 'read: crust.config.yaml'),
      call(1, 'read: package.json'),
      narration(2, 'the roster is already tuned'),
    ]

    // when
    const actual = turnsOf(events)

    // then
    expect(actual).toHaveLength(2)
    expect(actual[0]?.calls.map((c) => c.label)).toEqual([
      'read: crust.config.yaml',
      'read: package.json',
    ])
    expect(actual[1]?.calls).toEqual([])
  },
)

test(
  [
    'given lib/narration::turnsOf',
    'when the run predates narration and its events carry no turn',
    'it should still show the tool calls rather than dropping them',
  ].join(', '),
  () => {
    // given — every session traced before this feature existed
    const events = [
      event({
        type: 'tool_call',
        name: 'bash: bun test',
        payload_json: '{"tool":"bash"}',
      }),
    ]

    // when
    const actual = turnsOf(events)

    // then — an old run is still worth reading
    expect(actual).toHaveLength(1)
    expect(actual[0]?.turn).toBe(0)
    expect(actual[0]?.calls).toHaveLength(1)
  },
)

test(
  [
    'given lib/narration::turnsOf',
    'when an event payload is not valid JSON',
    'it should skip it rather than failing the whole pane',
  ].join(', '),
  () => {
    // given — a truncated write
    const events = [
      event({ type: 'narration', payload_json: '{"turn":1,"text":' }),
      narration(1, 'this one is fine'),
    ]

    // when
    const actual = turnsOf(events)

    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]?.blocks).toHaveLength(1)
  },
)

test(
  [
    'given lib/narration::isAtBottom',
    'when the browser reports a fractional scroll position',
    'it should still count as the bottom',
  ].join(', '),
  () => {
    // given — scroll arithmetic is fractional, and an exact comparison says
    // "not at the bottom" for a view that visibly is
    const scrollTop = 1399.6
    const scrollHeight = 2000
    const clientHeight = 600

    // when
    const actual = isAtBottom(scrollTop, scrollHeight, clientHeight)

    // then — otherwise following silently stops and the reader never knows why
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/narration::isAtBottom',
    'when the reader has scrolled up to read something',
    'it should report that they are no longer at the bottom',
  ].join(', '),
  () => {
    // given
    const scrollTop = 400

    // when
    const actual = isAtBottom(scrollTop, 2000, 600)

    // then — this is what stops new output moving the page under them
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/narration::shouldOfferJump',
    'when one message arrives while the reader is reading',
    'it should stay out of the way',
  ].join(', '),
  () => {
    // given
    const missed = 1

    // when
    const actual = shouldOfferJump(false, missed)

    // then — a button flickering in and out of a page is its own annoyance
    expect(actual).toBe(false)
  },
)

test(
  [
    'given lib/narration::shouldOfferJump',
    'when the backlog has grown past what is pleasant to scroll',
    'it should offer the shortcut back to the live edge',
  ].join(', '),
  () => {
    // given
    const missed = JUMP_THRESHOLD

    // when
    const actual = shouldOfferJump(false, missed)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given lib/narration::shouldOfferJump',
    'when the reader is already following the live edge',
    'it should never offer to take them there',
  ].join(', '),
  () => {
    // given — following means they are already at the bottom
    const missed = 500

    // when
    const actual = shouldOfferJump(true, missed)

    // then
    expect(actual).toBe(false)
  },
)
