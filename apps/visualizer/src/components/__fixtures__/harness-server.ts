import { createServer, type ViteDevServer } from 'vite'

/*
 * The browser-driven harness files used to each name a fixed port, which made
 * the port a machine-wide resource two things could take at once: two of them
 * had picked 59_744, so one run in one checkout could fail its own suite, and
 * two runs in two worktrees collided whatever the numbers were. Asking the OS
 * for an ephemeral port (`port: 0`) and reading back what it gave removes both
 * — nothing is reserved, so nothing can be reserved twice.
 */

/**
 * The port a listening server was actually given. `address()` returns an
 * `AddressInfo` for a TCP server that is listening; the string case is a unix
 * socket and the nullish case is a server that has not bound, and neither can
 * follow `await server.listen()` on a host/port configuration. Falling back to
 * 0 keeps this total — a harness handed `http://127.0.0.1:0` fails its first
 * navigation rather than silently talking to something else.
 */
const listeningPort = (httpServer: ViteDevServer['httpServer']): number => {
  const address = httpServer?.address()
  return typeof address === 'object' && address !== null ? address.port : 0
}

/**
 * A listening Vite dev server rooted at `apps/visualizer`, on a port the OS
 * chose, with the base URL to reach it. The caller closes it.
 */
export const startHarnessServer = async (): Promise<{
  server: ViteDevServer
  base: string
}> => {
  const server = await createServer({
    root: new URL('../../../', import.meta.url).pathname,
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
    },
    logLevel: 'silent',
  })
  await server.listen()

  return {
    server,
    base: `http://127.0.0.1:${listeningPort(server.httpServer)}`,
  }
}
