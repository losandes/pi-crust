import { afterEach, expect, test } from 'bun:test'
import type { EventRow } from '../typedefs/event'
import { fetchEvents } from './fetch-events'

let originalFetch: typeof fetch

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = originalFetch
})

originalFetch = globalThis.fetch

const stubFetch = (body: unknown) => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as Response) as unknown as typeof fetch
}

test(
  [
    'given domains/events::fetchEvents',
    'when the server answers with a paged object',
    'it should pass the page through, defaulting missing fields',
  ].join(', '),
  async () => {
    // given
    const event = { rowid: 3 } as EventRow
    stubFetch({ events: [event] })

    // when
    const actual = await fetchEvents('run-1', 0)

    // then
    expect(actual).toEqual({ events: [event], cursor: 0, has_more: false })
  },
)

test(
  [
    'given domains/events::fetchEvents',
    'when the server answers with a bare array (a server too old to page)',
    'it should derive the cursor from the highest rowid seen',
  ].join(', '),
  async () => {
    // given
    const events = [{ rowid: 2 }, { rowid: 5 }] as EventRow[]
    stubFetch(events)

    // when
    const actual = await fetchEvents('run-1', 0, 500, 'tree')

    // then
    expect(actual).toEqual({ events, cursor: 5, has_more: false })
  },
)

test(
  [
    'given domains/events::fetchEvents',
    'when the page is exactly as large as the limit',
    'it should report that more may follow',
  ].join(', '),
  async () => {
    // given
    stubFetch([{ rowid: 1 }] as EventRow[])

    // when
    const actual = await fetchEvents('run-1', 0, 1)

    // then
    expect(actual.has_more).toBe(true)
  },
)
