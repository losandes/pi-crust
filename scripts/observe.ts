#!/usr/bin/env bun
/**
 * observe — boot the trace UI for a stamped tree, from wherever pi-crust lives.
 *
 * Usage:
 *     bun <pi-crust>/scripts/observe.ts [vite flags...]
 *
 * Reads CRUST_DB (the trace to serve), and the ports from the stamped
 * `crust.observe.yaml` that sits beside it.
 *
 * CRUST_BE_PORT and CRUST_FE_PORT still win over the file. Every remaining
 * argument is passed to vite untouched.
 *
 * This exists so that nothing in a stamped tree has to know where pi-crust is
 * installed. The recipe that used to `cd` into a path under `.claude/skills/`
 * was correct only for the one repository pi-crust was developed in: move the
 * package to a global directory, a node_modules tree, or a git checkout shared
 * by several worktrees, and the path is wrong with no way to discover the
 * right one. A launcher resolves the app from its OWN location instead, which
 * is true wherever it was copied to.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_PORTS = { backend: 4600, frontend: 4601 } as const

/**
 * The ports the observed repository committed, if it committed any.
 *
 * Looked for beside the trace database first, since the stamp puts the
 * config one directory up from the data, and then in the working directory,
 * for a `CRUST_DB` pointed at a database somewhere else entirely. A tree
 * with neither is an older stamp, and the defaults are what it had anyway.
 *
 * Anything unreadable or malformed reads as "no answer", and the defaults
 * stand. Booting a UI is not worth failing over a file somebody half-edited.
 */
export const configuredPorts = (
  db: string,
): Readonly<{ backend: number; frontend: number }> => {
  const path = [
    join(dirname(dirname(resolve(db))), 'config', 'crust.observe.yaml'),
    resolve('.pi-crust/config/crust.observe.yaml'),
  ].find((candidate) => existsSync(candidate))
  if (path === undefined) {
    return DEFAULT_PORTS
  }
  // biome-ignore lint/plugin/no-intermediate-try-catch: this is the boundary the rule names — the file belongs to the observed repository and may be anything
  try {
    const parsed = Bun.YAML.parse(readFileSync(path, 'utf8')) as {
      ports?: { backend?: unknown; frontend?: unknown }
    }
    const port = (value: unknown, fallback: number): number =>
      Number.isInteger(value) && (value as number) > 0
        ? (value as number)
        : fallback

    return {
      backend: port(parsed?.ports?.backend, DEFAULT_PORTS.backend),
      frontend: port(parsed?.ports?.frontend, DEFAULT_PORTS.frontend),
    }
  } catch {
    return DEFAULT_PORTS
  }
}

/** The web app that ships beside this script, wherever this script is. */
export const visualizerDir = (): string =>
  resolve(
    dirname(new URL(import.meta.url).pathname),
    '..',
    'apps',
    'visualizer',
  )

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

/*
 * The API is only useful for as long as the UI in front of it is.
 *
 * The recipe this replaced backgrounded the server inside a subshell, so
 * quitting vite left it holding :4600 and the next `observe` failed on a port
 * already in use — by a process whose own owner could not say what it was.
 * Tying the two together is the behaviour everybody assumed was there.
 */
const stopWith = (server: ChildProcess): void => {
  const stop = (): void => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill('SIGTERM')
    }
  }
  process.on('exit', stop)
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

const main = (): number => {
  const app = visualizerDir()
  if (!existsSync(join(app, 'server', 'index.ts'))) {
    say(`observe: no visualizer at ${app}`)
    say('  this script must stay beside the apps/ directory pi-crust ships.')
    return 2
  }

  const db = process.env.CRUST_DB ?? resolve('.pi-crust/data/crust.db')
  const ports = configuredPorts(db)
  const bePort = process.env.CRUST_BE_PORT ?? String(ports.backend)
  const fePort = process.env.CRUST_FE_PORT ?? String(ports.frontend)

  const installed = spawnSync('bun', ['install'], {
    cwd: app,
    encoding: 'utf8',
  })
  if (installed.status !== 0) {
    say(`observe: bun install failed in ${app}`)
    say(`  ${(installed.stderr ?? '').trim().slice(-300)}`)
    return 1
  }

  const env = {
    ...process.env,
    CRUST_DB: db,
    CRUST_WORKSPACE_ROOT: process.cwd(),
    CRUST_BE_PORT: bePort,
    CRUST_FE_PORT: fePort,
  }
  const server = spawn('bun', ['run', 'server/index.ts'], {
    cwd: app,
    env,
    stdio: 'inherit',
  })
  stopWith(server)

  const vite = spawn('bunx', ['vite', ...process.argv.slice(2)], {
    cwd: app,
    env,
    stdio: 'inherit',
  })
  vite.on('exit', (code) => {
    process.exit(code ?? 0)
  })
  return 0
}

if (import.meta.main) {
  const status = main()
  if (status !== 0) {
    process.exit(status)
  }
}
