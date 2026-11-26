#!/usr/bin/env bun
/** Launch Vite from a clone, or the prebuilt UI and API from an installed package. */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { safeParseSettlement } from '../lib/typedefs'
import { loadConfig } from '../runtime/domains/config'
import {
  observeDbPath,
  observeEnv,
  type TObserveEnv,
} from '../runtime/domains/trace'
import { repoRoot, resolveDataPaths } from '../runtime/domains/workspace'
import { DEFAULT_CONFIG_PATH } from '../runtime/lib/contracts'
import { configPathFromEnv, type TEnv } from '../runtime/lib/system'

export const visualizerDir = (): string =>
  resolve(
    dirname(new URL(import.meta.url).pathname),
    '..',
    'apps',
    'visualizer',
  )

// ChildProcess uses null to represent a process that has not exited.
export type TObserveChild = Readonly<{
  exitCode: number | null
  signalCode: string | null
  kill: (signal: 'SIGTERM') => unknown
  on: (event: 'exit', listener: (code: number | null) => void) => unknown
}>
export type TObserveDeps = Readonly<{
  app: string
  env: TEnv
  execPath: string
  exists: (path: string) => boolean
  settings: (env: TEnv) => Readonly<{ db: string; launch: TObserveEnv }>
  spawn: (
    command: string,
    args: readonly string[],
    options: Readonly<{ cwd: string; env: TEnv; stdio: 'inherit' }>,
  ) => TObserveChild
  spawnSync: (
    command: string,
    args: readonly string[],
    options: Readonly<{ cwd: string; env: TEnv; encoding: 'utf8' }>,
  ) => Readonly<{ status: number | null; stderr: string }>
  say: (line: string) => void
  onStop: (
    event: 'exit' | 'SIGINT' | 'SIGTERM',
    listener: () => void,
  ) => unknown
  exit: (code: number) => unknown
}>

const stopWith =
  (deps: TObserveDeps) =>
  (server: TObserveChild): void => {
    const stop = (): void => {
      if (server.exitCode === null && server.signalCode === null)
        server.kill('SIGTERM')
    }
    deps.onStop('exit', stop)
    deps.onStop('SIGINT', stop)
    deps.onStop('SIGTERM', stop)
  }

const builtHost = (
  argv: readonly string[],
): Readonly<{ host: string; refused?: string }> => {
  const scan = (
    index: number,
    host: string,
  ): Readonly<{ host: string; refused?: string }> => {
    const arg = argv[index]
    if (arg === undefined) return { host }
    if (arg === '--strictPort') return scan(index + 1, host)
    if (arg.startsWith('--host=') && arg.length > 7)
      return scan(index + 1, arg.slice(7))
    if (arg === '--host') {
      const next = argv[index + 1]
      return next !== undefined && !next.startsWith('-')
        ? scan(index + 2, next)
        : scan(index + 1, '0.0.0.0')
    }
    return { host, refused: arg }
  }
  return scan(0, '127.0.0.1')
}

export const main =
  (deps: TObserveDeps) =>
  (argv: readonly string[]): number => {
    const source = deps.exists(join(deps.app, 'server/index.ts'))
    if (!(source || deps.exists(join(deps.app, 'server/index.js')))) {
      deps.say(`observe: no visualizer at ${deps.app}`)
      deps.say(
        '  this script must stay beside the apps/ directory pi-crust ships.',
      )
      return 2
    }
    const parsed = source ? { host: '' } : builtHost(argv)
    if (parsed.refused !== undefined) {
      deps.say(
        `observe: ${parsed.refused} is not available from an installed pi-crust; it accepts --host [<address>] and --strictPort`,
      )
      return 2
    }
    if (!(source || deps.exists(join(deps.app, 'dist/index.html')))) {
      deps.say(`observe: no built web UI at ${deps.app}/dist`)
      return 2
    }
    const base = Object.fromEntries(
      Object.entries(deps.env).filter(([key]) => key !== 'CRUST_UI_HOST'),
    )
    const settings = deps.settings(base)
    if (source) {
      const installed = deps.spawnSync('bun', ['install'], {
        cwd: deps.app,
        env: base,
        encoding: 'utf8',
      })
      if (installed.status !== 0) {
        deps.say(`observe: bun install failed in ${deps.app}`)
        deps.say(`  ${installed.stderr.trim().slice(-300)}`)
        return 1
      }
    }
    const env = {
      ...base,
      CRUST_DB: settings.db,
      ...settings.launch,
      ...(source ? {} : { CRUST_UI_HOST: parsed.host }),
    }
    const server = deps.spawn(
      source ? 'bun' : deps.execPath,
      source ? ['run', 'server/index.ts'] : [join(deps.app, 'server/index.js')],
      { cwd: deps.app, env, stdio: 'inherit' },
    )
    stopWith(deps)(server)
    const last = source
      ? deps.spawn('bunx', ['vite', ...argv], {
          cwd: deps.app,
          env,
          stdio: 'inherit',
        })
      : server
    last.on('exit', (code) => deps.exit(code ?? 0))
    return 0
  }

export const observeSettings =
  (root: () => string) =>
  (env: TEnv): ReturnType<TObserveDeps['settings']> => {
    const loaded = safeParseSettlement(() =>
      loadConfig(configPathFromEnv(env) ?? DEFAULT_CONFIG_PATH, env),
    )
    return {
      db: observeDbPath(
        env,
        loaded.status === 'ok'
          ? resolveDataPaths(loaded.data, root(), env).db
          : undefined,
      ),
      launch: observeEnv(
        loaded.status === 'ok' ? loaded.data.observability : undefined,
        env,
      ),
    }
  }

export const observeDeps: TObserveDeps = {
  app: visualizerDir(),
  env: process.env,
  execPath: process.execPath,
  exists: existsSync,
  settings: observeSettings(repoRoot),
  spawn,
  spawnSync: (command, args, options) => {
    const result = spawnSync(command, args, options)
    return { status: result.status, stderr: result.stderr ?? '' }
  },
  say: (line) => {
    process.stdout.write(`${line}\n`)
  },
  onStop: process.on.bind(process),
  exit: process.exit,
}

if (import.meta.main) {
  const status = main(observeDeps)(process.argv.slice(2))
  if (status !== 0) process.exit(status)
}
