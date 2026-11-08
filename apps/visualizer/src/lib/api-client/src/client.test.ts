import { afterEach, expect, test } from 'bun:test'
import { getJson, post, scope } from './client'

let originalFetch: typeof fetch

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = originalFetch
})

originalFetch = globalThis.fetch

const stubFetch = (
  response: Readonly<{ ok: boolean; status?: number; body: unknown }>,
) => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = (async () =>
    ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
      text: async () =>
        typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body),
    }) as Response) as unknown as typeof fetch
}

test(
  [
    'given lib/api-client::scope',
    'when no workspace is known',
    'it should contribute nothing to the URL',
  ].join(', '),
  () => {
    // given, when
    const actual = scope(undefined)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given lib/api-client::scope',
    'when a workspace is known',
    'it should encode it behind the given separator',
  ].join(', '),
  () => {
    // given, when
    const actual = scope('my tree', '&')

    // then
    expect(actual).toBe('&workspace=my%20tree')
  },
)

test(
  [
    'given lib/api-client::getJson',
    'when the server answers with a body',
    'it should resolve with the parsed JSON',
  ].join(', '),
  async () => {
    // given
    stubFetch({ ok: true, body: { hello: 'world' } })

    // when
    const actual = await getJson('/api/anything')

    // then
    expect(actual).toEqual({ hello: 'world' })
  },
)

test(
  [
    'given lib/api-client::getJson',
    'when the server answers with a failing status',
    'it should throw an error naming the URL and status',
  ].join(', '),
  async () => {
    // given
    stubFetch({ ok: false, status: 503, body: {} })

    // when, then
    await expect(getJson('/api/down')).rejects.toThrow('/api/down → 503')
  },
)

test(
  [
    'given lib/api-client::post',
    'when the write succeeds with a body',
    'it should settle ok with the parsed response',
  ].join(', '),
  async () => {
    // given
    stubFetch({ ok: true, body: { id: 1 } })

    // when
    const actual = await post('/api/write', { note: 'hi' })

    // then
    expect(actual).toEqual({ ok: true, data: { id: 1 } })
  },
)

test(
  [
    'given lib/api-client::post',
    'when the write succeeds with an empty body',
    'it should settle ok with an empty object',
  ].join(', '),
  async () => {
    // given
    stubFetch({ ok: true, body: '' })

    // when
    const actual = await post('/api/write', {})

    // then
    expect(actual).toEqual({ ok: true, data: {} })
  },
)

test(
  [
    'given lib/api-client::post',
    'when the server refuses the write',
    'it should settle not-ok with the explained failure',
  ].join(', '),
  async () => {
    // given
    stubFetch({ ok: false, status: 401, body: '' })

    // when
    const actual = await post('/api/write', {})

    // then
    expect(actual.ok).toBe(false)
  },
)

test(
  [
    'given lib/api-client::post',
    'when the network itself fails',
    'it should settle not-ok with the thrown message',
  ].join(', '),
  async () => {
    // given
    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = (() => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    // when
    const actual = await post('/api/write', {})

    // then
    expect(actual).toEqual({ ok: false, problem: 'offline' })
  },
)
