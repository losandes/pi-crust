import { expect, test } from 'bun:test'
import type { EventRow } from '../typedefs/event'
import {
  agentColor,
  argsSummary,
  dotColor,
  eventLabel,
  hexAlpha,
  parseAgentStart,
  parsePayload,
  parseToolCall,
} from './events'

const event = (overrides: Partial<EventRow> = {}): EventRow =>
  ({ event_id: 'e1', rowid: 1, type: 'tool_call', ...overrides }) as EventRow

test(
  [
    'given lib/events::dotColor',
    'when the type is absent',
    'it should be absent too, rather than a wrong colour',
  ].join(', '),
  () => {
    // given
    const type = null

    // when
    const actual = dotColor(type)

    // then
    expect(actual).toBeNull()
  },
)

test(
  [
    'given lib/events::dotColor',
    'when the type is known and when it is not',
    'it should resolve the known one and leave the other unresolved',
  ].join(', '),
  () => {
    // given
    const cases = ['agent_start', 'nonsense']

    // when
    const actual = cases.map((type) => dotColor(type))

    // then
    expect(actual).toEqual(['#c89bff', null])
  },
)

test(
  [
    'given lib/events::agentColor',
    'when a config colour is given',
    'it should win over the payload colour',
  ].join(', '),
  () => {
    // given
    const configColor = 'amber'
    const payloadColor = 'blue'

    // when
    const actual = agentColor(configColor, payloadColor, 0)

    // then
    expect(actual).toBe('amber')
  },
)

test(
  [
    'given lib/events::agentColor',
    'when neither a config nor a payload colour is given',
    'it should fall back to a role by position',
  ].join(', '),
  () => {
    // given
    const index = 1

    // when
    const actual = agentColor(null, undefined, index)

    // then
    expect(actual).toBe('amber')
  },
)

test(
  [
    'given lib/events::hexAlpha',
    'when asked for a role faded by an alpha',
    'it should resolve it against the theme',
  ].join(', '),
  () => {
    // given
    const color = 'amber'
    const alpha = 0.25

    // when
    const actual = hexAlpha(color, alpha)

    // then
    expect(actual).toBe('rgb(var(--amber-rgb) / 0.25)')
  },
)

test(
  [
    'given lib/events::parsePayload',
    'when the payload is absent, unparsable, or an array',
    'it should read as null, since none of those is a usable object',
  ].join(', '),
  () => {
    // given
    const cases: readonly (string | null | undefined)[] = [
      null,
      undefined,
      'not json',
      '[1,2]',
    ]

    // when
    const actual = cases.map((raw) => parsePayload(raw))

    // then
    expect(actual).toEqual([null, null, null, null])
  },
)

test(
  [
    'given lib/events::parsePayload',
    'when the payload is a JSON object',
    'it should parse it',
  ].join(', '),
  () => {
    // given
    const raw = JSON.stringify({ a: 1 })

    // when
    const actual = parsePayload(raw)

    // then
    expect(actual).toEqual({ a: 1 })
  },
)

test(
  [
    'given lib/events::parseToolCall',
    'when the payload has no tool field',
    'it should read as no tool call at all',
  ].join(', '),
  () => {
    // given
    const row = event({ payload_json: JSON.stringify({ args: {} }) })

    // when
    const actual = parseToolCall(row)

    // then
    expect(actual).toBeNull()
  },
)

test(
  [
    'given lib/events::parseToolCall',
    'when the payload names a tool',
    'it should parse it as a tool call',
  ].join(', '),
  () => {
    // given
    const row = event({
      payload_json: JSON.stringify({ tool: 'bash', args: { command: 'ls' } }),
    })

    // when
    const actual = parseToolCall(row)

    // then
    expect(actual?.tool).toBe('bash')
  },
)

test(
  [
    'given lib/events::parseAgentStart',
    'when the payload is a JSON object',
    'it should parse it',
  ].join(', '),
  () => {
    // given
    const row = event({
      type: 'agent_start',
      payload_json: JSON.stringify({ model: 'opus' }),
    })

    // when
    const actual = parseAgentStart(row)

    // then
    expect(actual).toEqual({ model: 'opus' })
  },
)

test(
  [
    'given lib/events::argsSummary',
    'when args is absent',
    'it should be empty',
  ].join(', '),
  () => {
    // given
    const args = undefined

    // when
    const actual = argsSummary(args)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given lib/events::argsSummary',
    'when args carries a recognised call-shaped key',
    'it should use it as the one-line summary, in priority order',
  ].join(', '),
  () => {
    // given
    const args = { file_path: 'a.ts', command: 'bun test a.ts' }

    // when
    const actual = argsSummary(args)

    // then
    expect(actual).toBe('bun test a.ts')
  },
)

test(
  [
    'given lib/events::argsSummary',
    'when no recognised key is present',
    'it should join every key=value pair, skipping null or undefined',
  ].join(', '),
  () => {
    // given
    const args = { limit: 5, note: null, label: 'x' }

    // when
    const actual = argsSummary(args)

    // then
    expect(actual).toBe('limit=5 label=x')
  },
)

test(
  [
    'given lib/events::argsSummary',
    'when a value is long enough to need truncating',
    'it should cut it at the max length with an ellipsis',
  ].join(', '),
  () => {
    // given
    const long = 'x'.repeat(200)
    const args = { command: long }

    // when
    const actual = argsSummary(args)

    // then
    expect(actual.endsWith('…')).toBe(true)
    expect(actual.length).toBe(161)
  },
)

test(
  [
    'given lib/events::eventLabel',
    'when a new-tracer tool_call already carries the human label in its name',
    'it should prefer the name over re-deriving one',
  ].join(', '),
  () => {
    // given
    const row = event({
      name: 'bash: ls -la src',
      payload_json: JSON.stringify({
        tool: 'bash',
        args: { command: 'ls -la src' },
      }),
    })

    // when
    const actual = eventLabel(row)

    // then
    expect(actual).toBe('bash: ls -la src')
  },
)

test(
  [
    'given lib/events::eventLabel',
    'when a tool_call has a tool but the event name does not already start with it',
    'it should derive tool: summary from the args',
  ].join(', '),
  () => {
    // given
    const row = event({
      name: 'tool',
      payload_json: JSON.stringify({
        tool: 'bash',
        args: { command: 'ls -la' },
      }),
    })

    // when
    const actual = eventLabel(row)

    // then
    expect(actual).toBe('bash: ls -la')
  },
)

test(
  [
    'given lib/events::eventLabel',
    'when a tool_call names a tool but its args summarise to nothing',
    'it should fall back to the bare tool name',
  ].join(', '),
  () => {
    // given
    const row = event({
      name: 'tool',
      payload_json: JSON.stringify({ tool: 'bash', args: {} }),
    })

    // when
    const actual = eventLabel(row)

    // then
    expect(actual).toBe('bash')
  },
)

test(
  [
    'given lib/events::eventLabel',
    'when a legacy tool_call carries a pi_event instead of a tool',
    'it should combine the event name with it',
  ].join(', '),
  () => {
    // given
    const row = event({
      name: 'legacy',
      payload_json: JSON.stringify({ pi_event: 'write' }),
    })

    // when
    const actual = eventLabel(row)

    // then
    expect(actual).toBe('legacy write')
  },
)

test(
  [
    'given lib/events::eventLabel',
    'when a tool_call is neither new- nor legacy-shaped',
    'it should fall back to the event name, then the type',
  ].join(', '),
  () => {
    // given
    const named = event({ name: 'raw tool', payload_json: null })
    const unnamed = event({ name: null, type: 'tool_call', payload_json: null })

    // when
    const actual = [eventLabel(named), eventLabel(unnamed)]

    // then
    expect(actual).toEqual(['raw tool', 'tool_call'])
  },
)

test(
  [
    'given lib/events::eventLabel',
    'when the event is not a tool_call at all',
    'it should use the event name',
  ].join(', '),
  () => {
    // given
    const row = event({ type: 'agent_end', name: 'agent finished' })

    // when
    const actual = eventLabel(row)

    // then
    expect(actual).toBe('agent finished')
  },
)
