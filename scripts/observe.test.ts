import { expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  restoreTerminal,
  silenceTerminal,
} from '../runtime/testing/terminal-capture'
import {
  main,
  observeDeps,
  observeSettings,
  type TObserveChild,
  type TObserveDeps,
  visualizerDir,
} from './observe'

test(
  [
    'given isolated launcher settings',
    'when loading valid and invalid configuration',
    'it should retain environment ports and fall back for an unreadable configuration',
  ].join(', '),
  () => {
    // given
    const scratch = mkdtempSync(join(tmpdir(), 'crust-observe-settings-'))
    const config = join(scratch, 'config.toml')
    const env = {
      CRUST_CONFIG: config,
      CRUST_MACHINE_CONFIG: join(scratch, 'no-machine'),
      CRUST_DATA_DIR: join(scratch, 'data'),
      CRUST_BE_PORT: '5600',
      CRUST_FE_PORT: '5601',
      HOME: scratch,
    }
    writeFileSync(config, '[ports]\nbackend = 5700\nfrontend = 5701\n')
    try {
      // when
      const valid = observeSettings(() => scratch)(env)
      writeFileSync(config, '= broken')
      const invalid = observeSettings(() => scratch)(env)
      silenceTerminal()
      observeDeps.say('observer boundary')
      restoreTerminal()
      // then
      expect(valid.db).toBe(join(scratch, 'data/crust.db'))
      expect(valid.launch).toEqual({
        CRUST_BE_PORT: '5600',
        CRUST_FE_PORT: '5601',
        CRUST_POLL_MS: '500',
      })
      expect(invalid.launch).toEqual(valid.launch)
    } finally {
      restoreTerminal()
      rmSync(scratch, { recursive: true, force: true })
    }
  },
)

const fixture = (
  mode = 'built',
  installStatus = 0,
  missingUi = false,
  exited = false,
) => {
  const record = mock(
    (_command: string, _args: readonly string[], _options: unknown) =>
      undefined,
  )
  const say = mock((_line: string) => undefined)
  const exit = mock((_code: number) => undefined)
  const kill = mock((_signal: 'SIGTERM') => undefined)
  const onStop = mock((_event: string, _listener: () => void) => undefined)
  const on = mock(
    (_event: 'exit', _listener: (code: number | null) => void) => undefined,
  )
  const child: TObserveChild = {
    exitCode: exited ? 0 : null,
    signalCode: null,
    kill,
    on,
  }
  const deps: TObserveDeps = {
    app: '/app',
    execPath: '/bin/node',
    env: { KEEP: 'yes', CRUST_UI_HOST: 'unsafe' },
    exists: (path) =>
      path ===
        `/app/server/index.${mode === 'source' ? 'ts' : mode === 'built' ? 'js' : 'none'}` ||
      (!missingUi && path === '/app/dist/index.html'),
    settings: () => ({
      db: '/data/crust.db',
      launch: {
        CRUST_BE_PORT: '4600',
        CRUST_FE_PORT: '4601',
        CRUST_POLL_MS: '500',
      },
    }),
    spawn: (command, args, options) => {
      record(command, args, options)
      return child
    },
    spawnSync: (command, args, options) => {
      record(command, args, options)
      return { status: installStatus, stderr: 'failed' }
    },
    say,
    onStop,
    exit,
  }
  return {
    deps,
    get calls() {
      return record.mock.calls.map(([command, args, options]) => ({
        command,
        args,
        options,
      }))
    },
    get lines() {
      return say.mock.calls.flat()
    },
    get exits() {
      return exit.mock.calls.flat()
    },
    get kills() {
      return kill.mock.calls.flat()
    },
    get stops() {
      return Object.fromEntries(onStop.mock.calls)
    },
    get listeners() {
      return on.mock.calls.map((call) => call[1])
    },
  }
}

test(
  [
    'given source mode with an inherited UI host',
    'when started with Vite flags',
    'it should install and launch with sanitized environments',
  ].join(', '),
  () => {
    // given
    const f = fixture('source')
    // when
    const status = main(f.deps)(['--open'])
    // then
    expect(status).toBe(0)
    expect(f.calls).toEqual([
      {
        command: 'bun',
        args: ['install'],
        options: { cwd: '/app', env: { KEEP: 'yes' }, encoding: 'utf8' },
      },
      ...[
        { command: 'bun', args: ['run', 'server/index.ts'] },
        { command: 'bunx', args: ['vite', '--open'] },
      ].map((call) => ({
        ...call,
        options: {
          cwd: '/app',
          stdio: 'inherit',
          env: {
            KEEP: 'yes',
            CRUST_DB: '/data/crust.db',
            CRUST_BE_PORT: '4600',
            CRUST_FE_PORT: '4601',
            CRUST_POLL_MS: '500',
          },
        },
      })),
    ])
    expect(visualizerDir().endsWith('/apps/visualizer')).toBe(true)
  },
)

for (const row of [
  { argv: [], host: '127.0.0.1' },
  { argv: ['--host'], host: '0.0.0.0' },
  { argv: ['--host', '--strictPort'], host: '0.0.0.0' },
  { argv: ['--strictPort'], host: '127.0.0.1' },
  { argv: ['--host', '10.0.0.1'], host: '10.0.0.1' },
  { argv: ['--host=::1'], host: '::1' },
])
  test(
    [
      'given built mode',
      `when called with ${row.argv.join(' ') || 'no flags'}`,
      'it should start only Node with the requested binding',
    ].join(', '),
    () => {
      // given
      const f = fixture()
      // when
      const status = main(f.deps)(row.argv)
      // then
      expect(status).toBe(0)
      expect(f.calls).toEqual([
        {
          command: '/bin/node',
          args: ['/app/server/index.js'],
          options: {
            cwd: '/app',
            stdio: 'inherit',
            env: {
              KEEP: 'yes',
              CRUST_DB: '/data/crust.db',
              CRUST_UI_HOST: row.host,
              CRUST_BE_PORT: '4600',
              CRUST_FE_PORT: '4601',
              CRUST_POLL_MS: '500',
            },
          },
        },
      ])
    },
  )

for (const argv of [['--open'], ['--unknown'], ['--host=']])
  test(
    [
      'given built mode',
      `when refusing ${argv[0]}`,
      'it should start nothing and explain supported flags',
    ].join(', '),
    () => {
      // given
      const f = fixture()
      // when
      const status = main(f.deps)(argv)
      // then
      expect(status).toBe(2)
      expect(f.calls).toEqual([])
      expect(f.lines[0]).toBe(
        `observe: ${argv[0]} is not available from an installed pi-crust; it accepts --host [<address>] and --strictPort`,
      )
    },
  )

for (const row of [
  {
    mode: 'source',
    install: 1,
    missing: false,
    status: 1,
    message: 'observe: bun install failed in /app',
    calls: 1,
  },
  {
    mode: 'built',
    install: 0,
    missing: true,
    status: 2,
    message: 'observe: no built web UI at /app/dist',
    calls: 0,
  },
  {
    mode: 'none',
    install: 0,
    missing: false,
    status: 2,
    message: 'observe: no visualizer at /app',
    calls: 0,
  },
])
  test(
    [
      'given an unavailable observer',
      `when ${row.message}`,
      'it should refuse before launching a server',
    ].join(', '),
    () => {
      // given
      const f = fixture(row.mode, row.install, row.missing)
      // when
      const status = main(f.deps)([])
      // then
      expect(status).toBe(row.status)
      expect(f.lines[0]).toBe(row.message)
      expect(f.calls).toHaveLength(row.calls)
    },
  )

for (const code of [0, 7, null])
  test(
    [
      'given a started observer',
      `when its server exits with ${code}`,
      'it should propagate the status and terminate live children on stop',
    ].join(', '),
    () => {
      // given
      const f = fixture()
      // when
      main(f.deps)([])
      f.stops.SIGINT?.()
      f.stops.SIGTERM?.()
      f.stops.exit?.()
      f.listeners[0]?.(code)
      // then
      expect(f.kills).toEqual(['SIGTERM', 'SIGTERM', 'SIGTERM'])
      expect(f.exits).toEqual([code ?? 0])
    },
  )

test(
  [
    'given an exited server',
    'when the observer stops',
    'it should leave the exited child alone',
  ].join(', '),
  () => {
    // given
    const f = fixture('built', 0, false, true)
    // when
    main(f.deps)([])
    f.stops.exit?.()
    // then
    expect(f.kills).toEqual([])
  },
)
