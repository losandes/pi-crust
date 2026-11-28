import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import type { EventRow, EventsPage } from '../typedefs/event'
import { createFetchEvents } from './fetch-events'

const event = (rowid: number): EventRow => ({
  rowid,
  event_id: `event-${rowid}`,
  run_id: 'run',
  activity_run_id: 'build',
  parent_id: '',
  type: 'tool_call',
  name: '',
  payload_json: '{}',
  tokens: 0,
  started_at: '2026-01-01T00:00:00Z',
  ended_at: '2026-01-01T00:00:00Z',
})

const redactor = createRedactor({ enabled: true, home: '/Users/ada' }).forRun({
  repository_root: '/srv/app',
})
const store: TRedactionStore = {
  base: async () => redactor,
  forRun: async () => redactor,
  remember: () => {},
}
const pages: readonly (readonly [unknown, number, EventsPage])[] = [
  [
    { events: [event(3)] },
    500,
    { events: [event(3)], cursor: 0, has_more: false },
  ],
  [
    [event(2), event(5)],
    500,
    { events: [event(2), event(5)], cursor: 5, has_more: false },
  ],
  [[event(1)], 1, { events: [event(1)], cursor: 1, has_more: true }],
  [{}, 500, { events: [], cursor: 0, has_more: false }],
  [
    { events: [], cursor: 7, has_more: true },
    500,
    { events: [], cursor: 7, has_more: true },
  ],
]
for (const [body, limit, expected] of pages) {
  test(
    [
      `given events ${JSON.stringify(body)}`,
      'when fetching a paged or legacy response',
      'it should retain pagination and defaults',
    ].join(', '),
    async () => {
      // given
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(Response.json(body))

      // when
      const actual = await createFetchEvents(store, request)(
        'run',
        0,
        limit,
        'tree',
      )
      // then
      expect(actual).toEqual(expected)
    },
  )
}

test(
  [
    'given event display text and identity fields',
    'when fetching events',
    'it should redact only name and payload and use the workspace address',
  ].join(', '),
  async () => {
    // given
    const recorded = {
      ...event(3),
      name: '/srv/app/x',
      payload_json: '{"path":"/Users/ada/x"}',
      event_id: '/srv/app/x',
    }
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(Response.json({ events: [recorded] }))
    const addressed: TRedactionStore = {
      ...store,
      forRun: (address) => {
        expect(address).toEqual({ runId: 'run', workspace: 'one' })
        return Promise.resolve(redactor)
      },
    }

    // when
    const actual = await createFetchEvents(addressed, request)(
      'run',
      0,
      500,
      'one',
    )
    // then
    expect(actual.events).toEqual([
      {
        ...recorded,
        name: '<repo>/x',
        payload_json: '{"path":"~/x"}',
      },
    ])
  },
)

test(
  [
    'given a rejecting store',
    'when events have content',
    'it should propagate the same rejection',
  ].join(', '),
  async () => {
    // given
    const failure = new Error('health unavailable')
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(Response.json([{ rowid: 1 }]))

    // when, then
    await expect(
      createFetchEvents(
        {
          ...store,
          forRun: () => {
            return Promise.reject(failure)
          },
        },
        request,
      )('run', 0),
    ).rejects.toBe(failure)
  },
)

test(
  [
    'given a failed event response',
    'when fetching events',
    'it should throw before requesting roots',
  ].join(', '),
  async () => {
    // given
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(new Response('', { status: 503 }))

    // when, then
    await expect(
      createFetchEvents(
        {
          ...store,
          forRun: () => {
            return Promise.reject(new Error('must not ask'))
          },
        },
        request,
      )('run', 0),
    ).rejects.toThrow('503')
  },
)
