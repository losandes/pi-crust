import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import { createGetJson, createPost, scope } from './client'

const redactor = createRedactor({ enabled: true, home: '/Users/ada' })
const store: TRedactionStore = {
  base: async () => redactor,
  forRun: async () => redactor,
  remember: () => {},
}
for (const [workspace, separator, expected] of [
  [undefined, '?', ''],
  ['', '?', ''],
  ['my tree', '&', '&workspace=my%20tree'],
] as const) {
  test(
    [
      `given workspace ${workspace}`,
      'when scoping a request',
      'it should encode only a known workspace',
    ].join(', '),
    () => {
      // given
      // when
      const actual = scope(workspace, separator)
      // then
      expect(actual).toBe(expected)
    },
  )
}
for (const status of [200, 503]) {
  test(
    [
      `given a GET response with status ${status}`,
      'when fetching JSON',
      'it should return the body or name the failed URL and status',
    ].join(', '),
    async () => {
      // given
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(Response.json({ hello: 'world' }, { status }))

      // when, then
      if (status === 200)
        expect(await createGetJson(request)('/api/anything')).toEqual({
          hello: 'world',
        })
      else
        await expect(createGetJson(request)('/api/down')).rejects.toThrow(
          '/api/down → 503',
        )
    },
  )
}
for (const [body, expected] of [
  ['{"id":1}', { id: 1 }],
  ['', {}],
] as const) {
  test(
    [
      `given a successful write body ${body}`,
      'when posting',
      'it should settle with the parsed body or an empty object',
    ].join(', '),
    async () => {
      // given
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(new Response(body))

      // when
      const actual = await createPost(store, request)('/api/write', {
        note: 'hi',
      })
      // then
      expect(actual).toEqual({ ok: true, data: expected })
    },
  )
}
for (const available of [true, false]) {
  test(
    [
      `given write failure and health available ${available}`,
      'when explaining the failure',
      'it should redact the body or omit it entirely',
    ].join(', '),
    async () => {
      // given
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(
        new Response('Failed /Users/ada/private/x', { status: 500 }),
      )
      const configured = available
        ? store
        : {
            ...store,
            base: () => {
              return Promise.reject(new Error('offline'))
            },
          }

      // when
      const actual = await createPost(configured, request)('/api/write', {})
      // then
      expect(actual).toEqual({
        ok: false,
        problem: available ? 'Failed ~/private/x' : 'Request failed (500).',
      })
    },
  )
}

test(
  [
    'given a refused write',
    'when posting with an injected store',
    'it should preserve the authentication explanation',
  ].join(', '),
  async () => {
    // given
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(new Response('', { status: 401 }))

    // when
    const actual = await createPost(store, request)('/api/write', {})
    // then
    expect(actual.ok).toBe(false)
  },
)
for (const cause of [new Error('offline'), 'offline']) {
  test(
    [
      `given a network rejection ${typeof cause}`,
      'when posting',
      'it should retain the thrown-error settlement',
    ].join(', '),
    async () => {
      // given
      const request =
        mock<
          (...args: Parameters<typeof fetch>) => Promise<Response>
        >().mockRejectedValue(cause)

      // when
      const actual = await createPost(store, request)('/api/write', {})
      // then
      expect(actual).toEqual({ ok: false, problem: 'offline' })
    },
  )
}
