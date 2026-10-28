import { expect, test } from 'bun:test'
import { runNoticesOf } from './notices'
import type { EventRow } from './types'

const event = (overrides: Partial<EventRow>): EventRow =>
  ({
    event_id: Math.random().toString(36).slice(2),
    rowid: 1,
    started_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as EventRow

test(
  [
    'given lib/notices::runNoticesOf',
    'when the run carries a developer_note event',
    'it should surface the note the person typed picking the run back up',
  ].join(', '),
  () => {
    // given
    const events = [
      event({
        type: 'log',
        name: 'developer_note',
        payload_json: JSON.stringify({
          note: 'I fixed the failing migration',
          from: 'alice',
          at: '2026-01-02T00:00:00.000Z',
        }),
      }),
    ]

    // when
    const actual = runNoticesOf(events)

    // then
    expect(actual).toEqual([
      {
        kind: 'note',
        text: 'I fixed the failing migration',
        from: 'alice',
        at: '2026-01-02T00:00:00.000Z',
      },
    ])
  },
)

test(
  [
    'given lib/notices::runNoticesOf',
    'when the run carries a branched_from event',
    'it should say where it came from',
  ].join(', '),
  () => {
    // given
    const events = [
      event({
        type: 'log',
        name: 'branched_from',
        payload_json: JSON.stringify({
          from_run_id: 'src00001',
          activity: 'design',
          seeding: 'fork',
          carried: ['scout'],
          at: '2026-01-02T00:00:00.000Z',
        }),
      }),
    ]

    // when
    const actual = runNoticesOf(events)

    // then
    expect(actual).toEqual([
      { kind: 'branched_from', runId: 'src00001', activity: 'design', at: '2026-01-02T00:00:00.000Z' },
    ])
  },
)

test(
  [
    'given lib/notices::runNoticesOf',
    'when the source run recorded a branch it sent off',
    'it should say where it went',
  ].join(', '),
  () => {
    // given — the other half of the same branch, recorded on the source
    const events = [
      event({
        type: 'steer',
        name: 'branch design',
        payload_json: JSON.stringify({
          target: 'branch',
          activity: 'design',
          note: 'try again',
          branch_run_id: 'brn00001',
          seeding: 'fork',
          replaying: ['design', 'plan'],
          at: '2026-01-02T00:00:00.000Z',
        }),
      }),
    ]

    // when
    const actual = runNoticesOf(events)

    // then
    expect(actual).toEqual([
      { kind: 'branched_to', runId: 'brn00001', activity: 'design', at: '2026-01-02T00:00:00.000Z' },
    ])
  },
)

test(
  [
    'given lib/notices::runNoticesOf',
    'when a steer event is an overwrite, not a branch',
    'it should produce no branched_to notice',
  ].join(', '),
  () => {
    // given
    const events = [
      event({
        type: 'steer',
        name: 'steer design',
        payload_json: JSON.stringify({ target: 'overwrite', activity: 'design' }),
      }),
    ]

    // when
    const actual = runNoticesOf(events)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given lib/notices::runNoticesOf',
    'when a payload is malformed or missing fields',
    'it should produce no entry rather than throw',
  ].join(', '),
  () => {
    // given
    const events = [
      event({ type: 'log', name: 'developer_note', payload_json: '{not json' }),
      event({ type: 'log', name: 'developer_note', payload_json: JSON.stringify({ note: '' }) }),
      event({
        type: 'log',
        name: 'branched_from',
        payload_json: JSON.stringify({ activity: 'design' }), // no from_run_id
      }),
    ]

    // when + then
    expect(() => runNoticesOf(events)).not.toThrow()
    expect(runNoticesOf(events)).toEqual([])
  },
)

test(
  [
    'given lib/notices::runNoticesOf',
    'when several notices exist',
    'it should order them oldest first',
  ].join(', '),
  () => {
    // given
    const events = [
      event({
        type: 'log',
        name: 'developer_note',
        payload_json: JSON.stringify({ note: 'second', at: '2026-01-02T00:00:00.000Z' }),
      }),
      event({
        type: 'log',
        name: 'branched_from',
        payload_json: JSON.stringify({
          from_run_id: 'src1',
          activity: 'scout',
          at: '2026-01-01T00:00:00.000Z',
        }),
      }),
    ]

    // when
    const actual = runNoticesOf(events)

    // then
    expect(actual.map((n) => n.kind)).toEqual(['branched_from', 'note'])
  },
)
