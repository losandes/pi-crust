#!/usr/bin/env bun
/**
 * observe — boot the trace UI for a stamped tree, from wherever pi-crust lives.
 *
 * Usage:
 *     bun <pi-crust>/scripts/observe.ts [vite flags...]
 *
 * Reads CRUST_DB (the trace to serve), CRUST_BE_PORT and CRUST_FE_PORT. Every
 * remaining argument is passed to vite untouched.
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
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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
  const bePort = process.env.CRUST_BE_PORT ?? '4600'
  const fePort = process.env.CRUST_FE_PORT ?? '4601'

  const installed = spawnSync('bun', ['install'], { cwd: app, encoding: 'utf8' })
  if (installed.status !== 0) {
    say(`observe: bun install failed in ${app}`)
    say(`  ${(installed.stderr ?? '').trim().slice(-300)}`)
    return 1
  }

  const env = {
    ...process.env,
    CRUST_DB: db,
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
