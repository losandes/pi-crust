import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TSettlement } from '../lib/typedefs/src/settlement'
import { createTracer, readRunState } from './domains/trace'
import { main, type TJoinDeps, USAGE } from './join'
import { agentConfigSchema, EXIT } from './lib/contracts'

type TFixtureOptions = Readonly<{
  status?: 'success' | 'fail' | 'stopped' | 'waiting'
  history?: boolean
  session?: boolean
  live?: boolean
  opened?: TSettlement<number>
}>

const fixture = (dir: string, options: TFixtureOptions = {}) => {
  const dbPath = join(dir, 'crust.db')
  const configPath = join(dir, 'crust.config.yaml')
  writeFileSync(
    configPath,
    `defaults:\n  data_dir: ${dir}\nobservability:\n  db: ${dbPath}\nagents: []\n`,
  )
  const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
  tracer.sessionStart('abcd1234', 'tester', 'sdlc')
  for (const params of [
    {
      name: 'request',
      kind: 'engineer',
      owner: 'tester',
      description: 'Describe the requested change',
    },
    {
      name: 'plan',
      kind: 'agent',
      owner: 'planner',
      description: 'Plan the requested change',
    },
  ] as const) {
    tracer.activityRunUpsert({
      activity_run_id: `abcd1234-${params.name}`,
      run_id: 'abcd1234',
      seq: params.name === 'request' ? 1 : 2,
      params,
      status: 'success',
      error: undefined,
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:01.000Z',
    })
  }
  if (options.session !== false) {
    tracer.agentSessionRow(
      'abcd1234',
      agentConfigSchema.parse({
        name: 'planner',
        prompt_engineering: { system: 'system.md', user: 'user.md' },
        writes: [],
      }),
      'session-1',
      0,
      0,
    )
  }
  if (options.status === 'stopped') {
    tracer.processStart('abcd1234', 'run', '', 999999, 'crust run')
  } else if (options.status === 'waiting') {
    tracer.sessionWaiting('abcd1234')
  } else {
    tracer.sessionFinish('abcd1234', options.status !== 'fail')
  }
  if (options.live)
    tracer.processStart('abcd1234', 'run', '', process.pid, 'crust run')
  tracer.close()
  const sessionDir = join(dir, 'sessions', 'abcd1234', 'planner', 'pi_sessions')
  const sessionFile = join(sessionDir, 'history.jsonl')
  if (options.history !== false) {
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: 'session', id: 'session-1', cwd: dir })}\n`,
    )
  }
  let calls: readonly (readonly string[])[] = []
  let output = ''
  const deps: TJoinDeps = {
    env: { CRUST_CONFIG: configPath, CRUST_DB: dbPath, CRUST_DATA_DIR: dir },
    piBinary: 'test-pi',
    open: (argv) => {
      calls = [...calls, argv]
      return Promise.resolve(options.opened ?? { status: 'ok', data: 0 })
    },
    write: (text) => {
      output = `${output}${text}`
    },
  }
  return {
    deps,
    dbPath,
    sessionDir,
    sessionFile,
    calls: () => calls,
    output: () => output,
  }
}

for (const status of ['success', 'fail', 'stopped', 'waiting'] as const) {
  test(
    [
      `given join::main and a ${status} run @SC1`,
      'when joining the plan activity',
      'it should open the recorded session interactively',
    ].join(', '),
    async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-join-'))
      try {
        const f = fixture(dir, { status })

        // when
        const actual = await main(f.deps)(['abcd1234', 'plan'])

        // then
        expect(actual).toBe(0)
        expect(f.calls()).toEqual([['test-pi', '--session', f.sessionFile]])
        expect(f.output()).toBe('')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given join::main and a child exiting non-zero',
    'when leaving the conversation',
    'it should return the child exit code',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-join-'))
    try {
      const f = fixture(dir, { opened: { status: 'ok', data: 3 } })

      // when
      const actual = await main(f.deps)(['abcd1234', 'plan'])

      // then
      expect(actual).toBe(3)
      expect(f.calls()).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given join::main and a stopped run @SC3',
    'when opening and leaving the conversation',
    'it should leave the trace and session files unchanged',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-join-'))
    try {
      const f = fixture(dir, { status: 'stopped' })
      const before = readRunState(f.dbPath, 'abcd1234')
      const runDir = join(dir, 'sessions', 'abcd1234')
      const filesBefore = readdirSync(runDir, { recursive: true }).toSorted()

      // when
      const actual = await main(f.deps)(['abcd1234', 'plan'])

      // then
      expect(actual).toBe(0)
      expect(f.calls()).toHaveLength(1)
      expect(readRunState(f.dbPath, 'abcd1234')).toEqual(before)
      expect(readdirSync(runDir, { recursive: true }).toSorted()).toEqual(
        filesBefore,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

for (const { name, argv, options, message } of [
  {
    name: 'an unknown run @SC4',
    argv: ['00000000', 'plan'],
    options: {},
    message: 'no run "00000000" was found',
  },
  {
    name: 'an unknown activity @SC4',
    argv: ['abcd1234', 'deploy'],
    options: {},
    message: 'has no activity "deploy"',
  },
  {
    name: 'an engineer activity @SC4',
    argv: ['abcd1234', 'request'],
    options: {},
    message: 'has no conversation to join',
  },
  {
    name: 'missing history @SC5',
    argv: ['abcd1234', 'plan'],
    options: { history: false },
    message: 'is no longer available',
  },
  {
    name: 'a live process @SC6',
    argv: ['abcd1234', 'plan'],
    options: { live: true },
    message: 'is still running',
  },
  {
    name: 'an unrecorded session',
    argv: ['abcd1234', 'plan'],
    options: { session: false },
    message: 'recorded no pi session',
  },
]) {
  test(
    [
      `given join::main and ${name}`,
      'when joining the activity',
      'it should refuse without opening pi or creating history',
    ].join(', '),
    async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-join-'))
      try {
        const f = fixture(dir, options)

        // when
        const actual = await main(f.deps)(argv)

        // then
        expect(actual).toBe(EXIT.FAILED)
        expect(f.calls()).toEqual([])
        expect(f.output()).toContain(message)
        if (options.history === false)
          expect(existsSync(f.sessionDir)).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

for (const argv of [
  ['only-one'],
  ['one', 'two', 'three'],
  ['--run-id', 'a', '--activity', 'b'],
  ['', 'plan'],
  ['abcd1234', ''],
]) {
  test(
    [
      `given join::main and invalid arguments ${JSON.stringify(argv)}`,
      'when parsing them with no config available',
      'it should return usage before touching config or opening pi',
    ].join(', '),
    async () => {
      // given
      let calls: readonly (readonly string[])[] = []
      let output = ''
      const deps: TJoinDeps = {
        env: { CRUST_CONFIG: '/no-such-crust-join-config.yaml' },
        piBinary: 'test-pi',
        open: (args) => {
          calls = [...calls, args]
          return Promise.resolve({ status: 'ok', data: 0 })
        },
        write: (text) => {
          output = `${output}${text}`
        },
      }

      // when
      const actual = await main(deps)(argv)

      // then
      expect(actual).toBe(EXIT.USAGE)
      expect(calls).toEqual([])
      expect(output).toContain(USAGE)
      if (argv[0] === '--run-id')
        expect(output).toBe(`unknown flag: --run-id\n${USAGE}\n`)
    },
  )
}

test(
  [
    'given join::main and a missing config',
    'when resolving a valid request',
    'it should report startup failure without opening pi',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-join-'))
    try {
      const f = fixture(dir)
      const deps = {
        ...f.deps,
        env: { ...f.deps.env, CRUST_CONFIG: join(dir, 'missing.yaml') },
      }

      // when
      const actual = await main(deps)(['abcd1234', 'plan'])

      // then
      expect(actual).toBe(EXIT.FAILED)
      expect(f.calls()).toEqual([])
      expect(f.output()).toStartWith('join: ')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given join::main and a spawn failure',
    'when opening the recorded session',
    'it should report the binary and error and return failure',
  ].join(', '),
  async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-join-'))
    try {
      const f = fixture(dir, {
        opened: { status: 'error', error: new Error('not executable') },
      })

      // when
      const actual = await main(f.deps)(['abcd1234', 'plan'])

      // then
      expect(actual).toBe(EXIT.FAILED)
      expect(f.calls()).toHaveLength(1)
      expect(f.output()).toBe('join: could not start test-pi: not executable\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
