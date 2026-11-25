import { expect, test } from 'bun:test'
import { SKIP_INTEGRATION } from '../../../runtime/testing/integration'
import { matchRoute, serveRoutes, type TRoutes } from './serve-routes'

const handler = () => new Response('matched')
const postHandler = () => new Response('post')
const routes: TRoutes = {
  '/api/health': handler,
  '/api/items/:name': handler,
  '/api/items/:name/files/*': handler,
  '/files/*': handler,
  '/method': { POST: handler },
}
const cases: readonly Readonly<{
  path: string
  method: string
  params: Readonly<Record<string, string>> | undefined
}>[] = [
  { path: '/api/health?x=1', method: 'GET', params: {} },
  { path: '/api/health', method: 'DELETE', params: {} },
  { path: '/api/health/', method: 'GET', params: undefined },
  { path: '/api/items/a%20b', method: 'GET', params: { name: 'a b' } },
  { path: '/api/items/', method: 'GET', params: undefined },
  { path: '/api/items/a/b', method: 'GET', params: undefined },
  { path: '/api/items/a/files/', method: 'GET', params: { name: 'a' } },
  { path: '/files/', method: 'GET', params: {} },
  { path: '/files/a/b', method: 'GET', params: {} },
  { path: '/files', method: 'GET', params: undefined },
  { path: '/method', method: 'GET', params: undefined },
  { path: '/method', method: 'POST', params: {} },
  { path: '/unknown', method: 'GET', params: undefined },
]

for (const one of cases) {
  test(
    [
      'given a route table',
      `when matching ${one.method} ${one.path}`,
      'it should preserve route and method boundaries',
    ].join(', '),
    () => {
      // given
      // when
      const actual = matchRoute(routes, one.method, one.path)
      // then
      expect(actual?.params).toEqual(one.params)
      expect(actual?.handler).toBe(
        one.params === undefined ? undefined : handler,
      )
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an HTTP route adapter',
    'when requests include bodies, parameters, fallback and failures',
    'it should bridge Web requests and responses including HEAD semantics',
  ].join(', '),
  async () => {
    // given
    const server = await serveRoutes({
      port: 0,
      hostname: '127.0.0.1',
      routes: {
        '/echo/:name': async (req) =>
          new Response(
            `${req.params.name}:${await req.text()}:${req.headers.get('x-test')}`,
            {
              status: 201,
              headers: { 'content-type': 'text/custom', 'x-answer': 'yes' },
            },
          ),
        '/head': () =>
          new Response('body bytes', {
            status: 202,
            headers: { 'x-answer': 'head' },
          }),
        '/method': { POST: postHandler },
        '/throws': () => {
          throw new Error('handler failed')
        },
      },
      fallback: (req) => {
        if (new URL(req.url).pathname === '/fallback-error')
          throw new Error('fallback failed')
        return new Response(`fallback:${req.method}`, { status: 404 })
      },
    })
    const url = `http://127.0.0.1:${server.port}`
    try {
      // when
      const echo = await fetch(`${url}/echo/a%20b?q=1`, {
        method: 'POST',
        headers: { 'x-test': 'input' },
        body: 'héllo',
      })
      const echoBody = await echo.text()
      const head = await fetch(`${url}/head`, { method: 'HEAD' })
      // then
      expect(echo.status).toBe(201)
      expect(echo.headers.get('content-type')).toBe('text/custom')
      expect(echo.headers.get('x-answer')).toBe('yes')
      expect(Number(echo.headers.get('content-length'))).toBe(
        Buffer.byteLength(echoBody),
      )
      expect(echoBody).toBe('a b:héllo:input')
      expect(head.status).toBe(202)
      expect(head.headers.get('x-answer')).toBe('head')
      expect(head.headers.get('content-length')).toBe('10')
      expect(await head.text()).toBe('')
      expect(await (await fetch(`${url}/method`)).text()).toBe('fallback:GET')
      expect(
        await (await fetch(`${url}/method`, { method: 'POST' })).text(),
      ).toBe('post')
      expect(await (await fetch(`${url}/missing`)).text()).toBe('fallback:GET')
      expect((await fetch(`${url}/throws`)).status).toBe(500)
      expect((await fetch(`${url}/fallback-error`)).status).toBe(500)
      await expect(
        serveRoutes({
          port: server.port,
          hostname: '127.0.0.1',
          routes: {},
          fallback: () => new Response(''),
        }),
      ).rejects.toThrow()
    } finally {
      await server.stop()
    }
  },
)
