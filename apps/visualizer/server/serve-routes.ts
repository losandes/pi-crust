import { createServer } from 'node:http'
import { buffer } from 'node:stream/consumers'

export type TRouteRequest = Request &
  Readonly<{ params: Readonly<Record<string, string>> }>
export type TRouteHandler = (req: TRouteRequest) => Response | Promise<Response>
export type TRoutes = Readonly<
  Record<string, TRouteHandler | Readonly<Record<string, TRouteHandler>>>
>

const routeParams = (
  pattern: string,
  pathname: string,
): Readonly<Record<string, string>> | undefined => {
  const expected = pattern.split('/')
  const actual = pathname.split('/')
  if (pattern.endsWith('/*')) {
    const prefix = expected.slice(0, -1)
    if (actual.length < expected.length) return undefined
    return routeParams(
      prefix.join('/'),
      actual.slice(0, prefix.length).join('/'),
    )
  }
  if (expected.length !== actual.length) return undefined
  const parts = expected.map((segment, index) => {
    const value = actual[index] ?? ''
    if (segment.startsWith(':'))
      return value === ''
        ? undefined
        : [segment.slice(1), decodeURIComponent(value)]
    return segment === value ? [] : undefined
  })
  return parts.some((part) => part === undefined)
    ? undefined
    : Object.fromEntries(
        parts.filter(
          (part): part is string[] => part !== undefined && part.length === 2,
        ),
      )
}

export const matchRoute = (
  routes: TRoutes,
  method: string,
  pathname: string,
):
  | Readonly<{
      handler: TRouteHandler
      params: Readonly<Record<string, string>>
    }>
  | undefined => {
  const path = pathname.split('?')[0] ?? ''
  const matches = Object.entries(routes).flatMap(([pattern, route]) => {
    const params = routeParams(pattern, path)
    const handler = typeof route === 'function' ? route : route[method]
    return params !== undefined && handler !== undefined
      ? [{ handler, params }]
      : []
  })
  return matches[0]
}

export const serveRoutes = async (
  options: Readonly<{
    port: number
    routes: TRoutes
    fallback: (req: Request) => Response | Promise<Response>
  }>,
): Promise<Readonly<{ port: number; stop: () => Promise<void> }>> => {
  const server = createServer(async (incoming, outgoing) => {
    // biome-ignore lint/plugin/no-intermediate-try-catch: HTTP boundary converts uncaught handler failures into a 500
    try {
      const incomingBody = await buffer(incoming)
      const method = incoming.method ?? 'GET'
      const headers = new Headers()
      Object.entries(incoming.headers).forEach(([name, value]) => {
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      })
      const request = new Request(
        `http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`,
        {
          method,
          headers,
          ...(method === 'GET' || method === 'HEAD'
            ? {}
            : { body: incomingBody }),
        },
      )
      const matched = matchRoute(
        options.routes,
        method,
        new URL(request.url).pathname,
      )
      const response =
        matched === undefined
          ? await options.fallback(request)
          : await matched.handler(
              // biome-ignore lint/plugin/no-object-mutation: this boundary owns the freshly constructed Request; spreading it would lose its Web API internal slots
              Object.assign(request, { params: matched.params }),
            )
      const body = Buffer.from(await response.arrayBuffer())
      outgoing.statusCode = response.status
      response.headers.forEach((value, name) => {
        outgoing.setHeader(name, value)
      })
      outgoing.setHeader('content-length', body.length)
      outgoing.end(method === 'HEAD' ? undefined : body)
    } catch (error) {
      void error
      outgoing.statusCode = 500
      outgoing.end('Internal Server Error')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('HTTP server has no port')
  return {
    port: address.port,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeIdleConnections()
      }),
  }
}
