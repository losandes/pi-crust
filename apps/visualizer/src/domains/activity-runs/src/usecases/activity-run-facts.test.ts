import { expect, test } from 'bun:test'
import type { EventRow } from '@/domains/events'
import type { ActivityRun, GateResult } from '../typedefs/activity-run'
import {
  activityRunUsage,
  checksLabel,
  eventDurationMs,
  gateChecks,
  money,
  requestText,
  violations,
} from './activity-run-facts'

const activityRun = (overrides: Partial<ActivityRun> = {}): ActivityRun =>
  ({
    activity_run_id: 'p1',
    name: 'build',
    kind: 'agent',
    ...overrides,
  }) as ActivityRun

const event = (overrides: Partial<EventRow> = {}): EventRow =>
  ({ event_id: 'e1', rowid: 1, type: 'agent_end', ...overrides }) as EventRow

const gate = (overrides: Partial<GateResult> = {}): GateResult =>
  ({ id: 1, gate: 'checks', passed: 1, ...overrides }) as GateResult

test(
  [
    'given lib/activity-run-facts::activityRunUsage',
    'when the agent_end payload is malformed',
    'it should render a usage panel built from what was recorded',
  ].join(', '),
  () => {
    // given — a truncated write, which has happened
    const events = [event({ payload_json: '{"usage":', tokens: 1234 })]

    // when
    const actual = activityRunUsage(activityRun(), events)

    // then — a broken payload costs the panel its detail, never the view
    expect(actual?.partial).toBe(true)
    expect(actual?.rows).toEqual([
      { label: 'total', tokens: 1234, cost: 0, kind: 'total' },
    ])
  },
)

test(
  [
    'given lib/activity-run-facts::activityRunUsage',
    'when the run reported reasoning tokens',
    'it should price them at the output rate and mark them as already counted',
  ].join(', '),
  () => {
    // given — thinking bills at the output rate and sits inside the output row
    const events = [
      event({
        payload_json: JSON.stringify({
          usage: {
            input_tokens: 100,
            input_cost: 1,
            output_tokens: 200,
            output_cost: 10,
            reasoning_tokens: 50,
            cache_read_tokens: 0,
            cache_read_cost: 0,
            cache_write_tokens: 0,
            cache_write_cost: 0,
            total_tokens: 300,
            total_cost: 11,
          },
        }),
      }),
    ]

    // when
    const actual = activityRunUsage(activityRun(), events)
    const thinking = actual?.rows.find((row) => row.label === 'thinking')

    // then — 50 of 200 output tokens is a quarter of the output cost
    expect(thinking?.cost).toBe(2.5)
    expect(thinking?.kind).toBe('nested')
    // and the total is unchanged by it, because it was never separate
    expect(actual?.rows.find((row) => row.label === 'total')?.cost).toBe(11)
  },
)

test(
  [
    'given lib/activity-run-facts::gateChecks',
    'when a gate recorded that it inspected nothing',
    'it should keep that distinct from a gate that recorded no evidence at all',
  ].join(', '),
  () => {
    // given
    const inspectedNothing = gate({ checks_json: '[]' })
    const recordedNothing = gate({ checks_json: null })

    // when
    const empty = gateChecks(inspectedNothing)
    const absent = gateChecks(recordedNothing)

    // then — "zero items checked" is a finding; "no evidence" is a legacy row
    expect(empty).toEqual([])
    expect(absent).toBeUndefined()
  },
)

test(
  [
    'given lib/activity-run-facts::checksLabel',
    'when some checks failed',
    'it should say how many rather than only how many ran',
  ].join(', '),
  () => {
    // given
    const checks = [
      { item: 'a', ok: true, note: '' },
      { item: 'b', ok: false, note: '' },
      { item: 'c', ok: false, note: '' },
    ]

    // when
    const actual = checksLabel(checks)

    // then
    expect(actual).toBe('2 of 3 failed')
  },
)

test(
  [
    'given lib/activity-run-facts::violations',
    'when the violations column holds text that is not JSON',
    'it should surface the raw text rather than swallowing it',
  ].join(', '),
  () => {
    // given
    const raw = gate({ passed: 0, violations_json: 'exit 1: tests failed' })

    // when
    const actual = violations(raw)

    // then
    expect(actual).toEqual(['exit 1: tests failed'])
  },
)

test(
  [
    'given lib/activity-run-facts::requestText',
    "when the request activityRun logged the engineer's ask",
    'it should find it among events that are not all JSON',
  ].join(', '),
  () => {
    // given
    const events = [
      event({ type: 'log', payload_json: 'not json at all' }),
      event({
        type: 'log',
        payload_json: JSON.stringify({ input: 'add a health endpoint' }),
      }),
    ]

    // when
    const actual = requestText(activityRun({ kind: 'engineer' }), events)

    // then
    expect(actual).toBe('add a health endpoint')
  },
)

test(
  [
    'given lib/activity-run-facts::money',
    'when a component cost rounds to nothing at four places',
    'it should say it is below the floor rather than printing zero',
  ].join(', '),
  () => {
    // given — per-component costs genuinely run this small
    const cost = 0.000_02

    // when
    const actual = money(cost)

    // then
    expect(actual).toBe('<$0.0001')
  },
)

test(
  [
    'given lib/activity-run-facts::violations',
    'when the column holds a JSON array of violations',
    'it should return each entry, stringifying non-string ones',
  ].join(', '),
  () => {
    // given
    const raw = gate({
      passed: 0,
      violations_json: JSON.stringify(['missing given', { line: 12 }]),
    })

    // when
    const actual = violations(raw)

    // then
    expect(actual).toEqual(['missing given', JSON.stringify({ line: 12 })])
  },
)

test(
  [
    'given lib/activity-run-facts::gateChecks',
    'when the column holds a JSON array of per-item checks',
    'it should normalise each item, defaulting anything malformed',
  ].join(', '),
  () => {
    // given
    const raw = gate({
      checks_json: JSON.stringify([
        { item: 'has tests', ok: true, note: 'fine' },
        { ok: 'yes' },
        'not an object',
        null,
      ]),
    })

    // when
    const actual = gateChecks(raw)

    // then
    expect(actual).toEqual([
      { item: 'has tests', ok: true, note: 'fine' },
      { item: '', ok: false, note: '' },
    ])
  },
)

test(
  [
    'given lib/activity-run-facts::eventDurationMs',
    'when the event has both a started_at and an ended_at',
    'it should be the difference between them',
  ].join(', '),
  () => {
    // given
    const row = event({
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.500Z',
    })

    // when
    const actual = eventDurationMs(row)

    // then
    expect(actual).toBe(1500)
  },
)

test(
  [
    'given lib/activity-run-facts::eventDurationMs',
    'when a tool_call row has no ended_at but its payload reports a duration',
    'it should fall back to the payload',
  ].join(', '),
  () => {
    // given — older tracers never recorded ended_at for tool calls
    const row = event({
      type: 'tool_call',
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: null,
      payload_json: JSON.stringify({ tool: 'bash', duration_ms: 42 }),
    })

    // when
    const actual = eventDurationMs(row)

    // then
    expect(actual).toBe(42)
  },
)

test(
  [
    'given lib/activity-run-facts::eventDurationMs',
    'when neither the timestamps nor a tool_call payload say how long it took',
    'it should be NaN',
  ].join(', '),
  () => {
    // given
    const row = event({ type: 'log', started_at: null, ended_at: null })

    // when
    const actual = eventDurationMs(row)

    // then
    expect(Number.isNaN(actual)).toBe(true)
  },
)
