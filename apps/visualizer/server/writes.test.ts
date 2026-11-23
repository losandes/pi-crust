import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  crustRuntime,
  isInboxKind,
  isSafeSegment,
  NO_ENTRY,
  NO_RUNTIME,
  postMessage,
  recordDecision,
  refuseUnlessAuthorised,
  resumeEntry,
  resumeRun,
  runWorkingTree,
  sessionDir,
  startConsult,
  startRun,
  startSteer,
  startupFailure,
  TOKEN_HEADER,
} from './writes.ts'

/**
 * A fake `spawn` that records every call rather than starting a real
 * process (1.3.7, 1.4.2) \u2014 the function under test receives this in place
 * of `node:child_process`'s own `spawn`, which is exactly what the injected
 * parameter exists for.
 */
type TFakeChild = Readonly<{
  pid: number
  stdout: EventEmitter
  stderr: EventEmitter
  unref: () => void
}>

type TSpawnCall = Readonly<{
  command: string
  args: readonly string[]
  options: Readonly<Record<string, unknown>>
  child: TFakeChild
}>

/**
 * The environment a spawn was given. `options` is an untyped bag, so the read
 * is a cast either way; defaulting to `{}` keeps a missing call from throwing
 * a TypeError in place of the assertion that would have reported it.
 */
const envOf = (call: TSpawnCall | undefined): Record<string, string> =>
  (call?.options.env ?? {}) as Record<string, string>

const spawnSpy = (): Readonly<{
  calls: readonly TSpawnCall[]
  spawnChild: typeof spawn
}> => {
  let calls: readonly TSpawnCall[] = []
  const spawnChild = ((
    command: string,
    args: readonly string[],
    options: Record<string, unknown>,
  ) => {
    const child: TFakeChild = {
      pid: 4242,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      unref: () => {},
    }
    calls = [...calls, { command, args, options, child }]
    return child
  }) as unknown as typeof spawn
  return {
    // A getter rather than returning the array by value: each call captures
    // the current snapshot, so a test sees every call made up to the point
    // it reads `calls`, not just the empty array this closure started with.
    get calls() {
      return calls
    },
    spawnChild,
  }
}

/**
 * A stamped tree, as an install leaves one: config, data, and NO runtime.
 *
 * The runtime ships with the package, so a server that resolves an entry
 * point relative to the repository resolves it to nothing — which is what
 * every write action in this UI was doing.
 */
const stampedTree = (home?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'crust-writes-'))
  mkdirSync(join(root, '.pi-crust', 'data'), { recursive: true })
  if (home !== undefined) {
    writeFileSync(join(root, '.pi-crust', 'pi-crust-home'), home)
  }
  return root
}

/** A package, as an install reads one: `runtime/cli.ts` is what proves it. */
const packageTree = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'crust-home-'))
  mkdirSync(join(home, 'runtime', 'lifecycles'), { recursive: true })
  writeFileSync(join(home, 'runtime', 'cli.ts'), '')
  return home
}

const dbOf = (root: string): string =>
  join(root, '.pi-crust', 'data', 'crust.db')

/**
 * Parses `inbox.jsonl` exactly as `runtime/domains/agents/src/data/inbox.ts::readInbox`
 * does: skip a blank line, drop anything whose `kind` is not one this
 * run understands. There is no import across this boundary (see the
 * `resumeRun`/`developerNote` pin below for why), so this side pins the
 * wire format it writes with the same tolerance the runtime reader applies.
 */
const readInboxLikeTheRuntimeDoes = (
  path: string,
): readonly Readonly<{ kind: string; message: string; from: string }>[] => {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const parsed = JSON.parse(line) as Partial<{
        kind: unknown
        message: unknown
        from: unknown
      }>
      if (!['steer', 'follow_up', 'abort'].includes(parsed.kind as string))
        return []
      return [
        {
          kind: parsed.kind as string,
          message: typeof parsed.message === 'string' ? parsed.message : '',
          from: typeof parsed.from === 'string' ? parsed.from : 'unknown',
        },
      ]
    })
}

/** The one table `resumeRun`'s note-recording touches, as a real trace db has it. */
const withEventsTable = (dbPath: string): string => {
  mkdirSync(join(dbPath, '..'), { recursive: true })
  const db = new Database(dbPath, { create: true })
  db.run(
    'CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, run_id TEXT, ' +
      'activity_run_id TEXT, type TEXT, name TEXT, payload_json TEXT, started_at TEXT)',
  )
  db.close()
  return dbPath
}

/**
 * Temporary trees, removed between tests.
 *
 * A Set rather than an array being pushed into: what this holds is a set of
 * paths to delete, and emptying it is one operation rather than a splice.
 */
const created = new Set<string>()
const track = (path: string): string => {
  created.add(path)
  return path
}

/** The environment, passed rather than mutated — the whole point of the parameter. */
const withHome = (
  home?: string,
): Readonly<Record<string, string | undefined>> =>
  home === undefined
    ? { HOME: '/nonexistent/crust-home' }
    : { HOME: '/nonexistent/crust-home', CRUST_HOME: home }

afterEach(() => {
  for (const path of created) {
    rmSync(path, { recursive: true, force: true })
  }
  created.clear()
})

test(
  [
    'given server/writes::crustRuntime',
    'when the stamp recorded where pi-crust was installed from',
    'it should resolve the runtime there rather than inside the repository',
  ].join(', '),
  () => {
    // given
    const home = track(packageTree())
    const root = track(stampedTree(home))

    // when
    const actual = crustRuntime({ ...withHome(), HOME: root })

    // then
    expect(actual).toBe(join(home, 'runtime'))
  },
)

test(
  [
    'given server/writes::crustRuntime',
    'when CRUST_HOME is set',
    'it should win, because that is the repair when the package moves',
  ].join(', '),
  () => {
    // given
    const home = track(packageTree())
    const root = track(stampedTree('/gone/stale/path'))

    // when
    const actual = crustRuntime({ ...withHome(home), HOME: root })

    // then
    expect(actual).toBe(join(home, 'runtime'))
  },
)

test(
  [
    'given server/writes::crustRuntime',
    'when nothing says where pi-crust is',
    'it should be undefined rather than a path that cannot exist',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const actual = crustRuntime({ ...withHome(), HOME: root })

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given server/writes::startSteer',
    'when the runtime cannot be found',
    'it should refuse and say so, rather than report a steer that never ran',
  ].join(', '),
  () => {
    // given — a pid proves a process started, not that it found its module
    const root = track(stampedTree())

    // when
    const actual = startSteer(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'overwrite',
      'x',
      undefined,
      withHome(),
    )

    // then
    expect(actual.started).toBe(false)
    expect(actual.pid).toBeUndefined()
    expect(actual.reason).toBe(NO_RUNTIME)
  },
)

test(
  [
    'given server/writes::startRun',
    'when the runtime cannot be found',
    'it should hand back no run id, so nothing is told to watch for one',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const actual = startRun(
      dbOf(root),
      root,
      'sdlc',
      'add a /health endpoint',
      [],
      withHome(),
    )

    // then
    expect(actual.run_id).toBe('')
    expect(actual.reason).toBe(NO_RUNTIME)
  },
)

test(
  [
    'given server/writes::startSteer',
    'when the target is branch and a minted id is given',
    'it should return that id in branch_run_id',
  ].join(', '),
  () => {
    // given — the server mints the id because a branch detaches, and the
    // response cannot wait to learn what the child decided
    const root = track(stampedTree())

    // when
    const actual = startSteer(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'branch',
      'try again',
      'deadbeef',
    )

    // then — the runtime is not found in this stamp, but the id is still echoed
    expect(actual.branch_run_id).toBe('deadbeef')
  },
)

test(
  [
    'given server/writes::startSteer',
    'when the target is overwrite',
    'it should carry no branch_run_id at all',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const actual = startSteer(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'overwrite',
      'x',
      'deadbeef',
    )

    // then
    expect(actual.branch_run_id).toBe('')
  },
)

test(
  [
    'given server/writes::postMessage',
    "when a steer message is posted through the web app's write endpoint",
    "it should be deliverable by the runtime's own inboxSince, the mechanism execute-agent.ts polls to steer a running agent",
  ].join(', '),
  () => {
    // given: this is the one shared surface a web app and a running pi
    // process both have: no socket, no import across the skill boundary,
    // just the file both sides append to and read in the same shape.
    const root = track(stampedTree())

    // when
    postMessage(
      dbOf(root),
      'a1b2c3d4',
      'steer',
      'stop and check the registry',
      'alice',
    )
    const path = join(sessionDir(dbOf(root), 'a1b2c3d4'), 'inbox.jsonl')
    const actual = readInboxLikeTheRuntimeDoes(path)

    // then: a message typed into the dialog that the runtime cannot parse
    // is a message that was never received, which is the exact regression
    // this proves does not recur
    expect(actual).toHaveLength(1)
    expect(actual[0]).toMatchObject({
      kind: 'steer',
      message: 'stop and check the registry',
      from: 'alice',
    })
  },
)

test(
  [
    'given server/writes::postMessage',
    'when a follow_up is posted after a steer',
    'it should keep both, in the order they were sent',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    postMessage(
      dbOf(root),
      'a1b2c3d4',
      'steer',
      'use the existing table',
      'alice',
    )
    postMessage(
      dbOf(root),
      'a1b2c3d4',
      'follow_up',
      'then write it up',
      'alice',
    )
    const path = join(sessionDir(dbOf(root), 'a1b2c3d4'), 'inbox.jsonl')
    const actual = readInboxLikeTheRuntimeDoes(path)

    // then
    expect(actual.map((entry) => entry.kind)).toEqual(['steer', 'follow_up'])
    expect(actual.map((entry) => entry.message)).toEqual([
      'use the existing table',
      'then write it up',
    ])
  },
)

test(
  [
    'given server/writes::resumeRun',
    'when a note is given and steering.md already has earlier content',
    'it should append the note and leave what was there',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())
    const handoffDir = join(
      root,
      '.pi-crust',
      'data',
      'sessions',
      'a1b2c3d4',
      'context_handoff',
    )
    mkdirSync(handoffDir, { recursive: true })
    writeFileSync(
      join(handoffDir, 'steering.md'),
      '## earlier entry\n\nfrom before\n',
    )
    withEventsTable(dbOf(root))

    // when
    const actual = resumeRun(dbOf(root), 'a1b2c3d4', 'I fixed the migration')

    // then
    const text = readFileSync(join(handoffDir, 'steering.md'), 'utf8')
    expect(text).toContain('from before')
    expect(text).toContain('## Instruction from the developer at')
    expect(text).toContain('I fixed the migration')
    expect(actual.note_recorded).toBe(join(handoffDir, 'steering.md'))
  },
)

test(
  [
    'given server/writes::resumeRun',
    'when no note is given',
    'it should write no steering.md at all',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())
    const handoffDir = join(
      root,
      '.pi-crust',
      'data',
      'sessions',
      'a1b2c3d4',
      'context_handoff',
    )

    // when
    const actual = resumeRun(dbOf(root), 'a1b2c3d4')

    // then
    expect(existsSync(join(handoffDir, 'steering.md'))).toBe(false)
    expect(actual.note_recorded).toBe('')
  },
)

test(
  [
    'given server/writes::resumeRun',
    'the steering-entry heading it writes',
    'must match runtime/domains/handoff/src/use-cases/steer.ts::developerNote exactly',
  ].join(', '),
  () => {
    // given — there is no import across this boundary: this server resolves
    // whatever workspace it is pointed at, and runtime/ ships with the
    // package rather than with the stamp, so both sides duplicate the
    // format and each pins it with a test. This is this side's pin.
    const root = track(stampedTree())
    const handoffDir = join(
      root,
      '.pi-crust',
      'data',
      'sessions',
      'a1b2c3d4',
      'context_handoff',
    )
    withEventsTable(dbOf(root))

    // when
    resumeRun(dbOf(root), 'a1b2c3d4', 'smoke test note')

    // then
    const text = readFileSync(join(handoffDir, 'steering.md'), 'utf8')
    expect(text).toMatch(
      /^## Instruction from the developer at .+\n\nsmoke test note\n/,
    )
  },
)

test(
  [
    'given server/writes::startSteer',
    'when the target is overwrite and the runtime is found',
    'it should spawn steer.ts with the overwrite argv, cwd, CRUST_DB and detached (1.3.3)',
  ].join(', '),
  () => {
    // given
    const home = track(packageTree())
    const root = track(stampedTree(home))
    const spy = spawnSpy()
    const { spawnChild } = spy

    // when
    const actual = startSteer(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'overwrite',
      'try again',
      undefined,
      withHome(home),
      spawnChild,
    )

    // then
    expect(actual.started).toBe(true)
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]?.command).toBe('bun')
    expect(spy.calls[0]?.args).toEqual([
      join(home, 'runtime', 'commands', 'steer.ts'),
      'a1b2c3d4',
      'plan',
      '--overwrite',
      'try again',
    ])
    expect(spy.calls[0]?.options.cwd).toBe(root)
    expect(spy.calls[0]?.options.detached).toBe(true)
    expect(envOf(spy.calls[0]).CRUST_DB).toBe(dbOf(root))

    // and — the stdout/stderr listeners this function wires up actually forward to the log
    spy.calls[0]?.child.stdout.emit('data', 'stdout line\n')
    spy.calls[0]?.child.stderr.emit('data', 'stderr line\n')
    const logged = readFileSync(actual.log, 'utf8')
    expect(logged).toContain('stdout line')
    expect(logged).toContain('stderr line')
  },
)

test(
  [
    'given server/writes::startSteer',
    'when the target is branch',
    'it should spawn with --branch, --seeding fork and the branch id (1.3.4)',
  ].join(', '),
  () => {
    // given
    const home = track(packageTree())
    const root = track(stampedTree(home))
    const spy = spawnSpy()
    const { spawnChild } = spy

    // when
    const actual = startSteer(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'branch',
      'try again',
      'deadbeef',
      withHome(home),
      spawnChild,
    )

    // then
    expect(actual.started).toBe(true)
    expect(actual.branch_run_id).toBe('deadbeef')
    expect(spy.calls[0]?.args).toEqual([
      join(home, 'runtime', 'commands', 'steer.ts'),
      'a1b2c3d4',
      'plan',
      '--branch',
      '--seeding',
      'fork',
      '--branch-id',
      'deadbeef',
      'try again',
    ])
  },
)

test(
  [
    'given server/writes::startConsult',
    'when the runtime is found',
    "it should spawn ask.ts with the run id, activity and question, in the run's tree (1.3.3)",
  ].join(', '),
  () => {
    // given
    const home = track(packageTree())
    const root = track(stampedTree(home))
    const spy = spawnSpy()
    const { spawnChild } = spy

    // when
    const actual = startConsult(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'ask',
      'why did this fail?',
      withHome(home),
      spawnChild,
    )

    // then
    expect(actual.started).toBe(true)
    expect(spy.calls[0]?.args).toEqual([
      join(home, 'runtime', 'commands', 'ask.ts'),
      'a1b2c3d4',
      'plan',
      'why did this fail?',
    ])
    expect(spy.calls[0]?.options.cwd).toBe(root)
    expect(spy.calls[0]?.options.detached).toBe(true)
    expect(envOf(spy.calls[0]).CRUST_DB).toBe(dbOf(root))

    spy.calls[0]?.child.stdout.emit('data', 'stdout line\n')
    spy.calls[0]?.child.stderr.emit('data', 'stderr line\n')
    const logged = readFileSync(actual.log, 'utf8')
    expect(logged).toContain('stdout line')
    expect(logged).toContain('stderr line')
  },
)

test(
  [
    'given server/writes::resumeRun',
    'when invocation.json records the original argv',
    'it should re-spawn that script with the run id and --resume, carrying CRUST_DB (1.3.3)',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())
    const dir = sessionDir(dbOf(root), 'a1b2c3d4')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'invocation.json'),
      JSON.stringify({
        argv: ['bun', 'runtime/cli.ts', '--lifecycle', 'sdlc'],
        cwd: root,
      }),
    )
    const spy = spawnSpy()
    const { spawnChild } = spy
    const home = track(packageTree())
    const env = { ...withHome(home), CRUST_DB: dbOf(root) }

    // when
    const actual = resumeRun(
      dbOf(root),
      'a1b2c3d4',
      '',
      'the web app',
      env,
      spawnChild,
    )

    // then
    expect(actual.resumed).toBe(true)
    expect(spy.calls[0]?.command).toBe('bun')
    expect(spy.calls[0]?.args).toEqual([
      join(home, 'runtime/cli.ts'),
      '--lifecycle',
      'sdlc',
      '--run-id',
      'a1b2c3d4',
      '--resume',
    ])
    expect(spy.calls[0]?.options.cwd).toBe(root)
    expect(spy.calls[0]?.options.detached).toBe(true)
    expect(envOf(spy.calls[0]).CRUST_DB).toBe(dbOf(root))

    spy.calls[0]?.child.stdout.emit('data', 'stdout line\n')
    spy.calls[0]?.child.stderr.emit('data', 'stderr line\n')
    const logged = readFileSync(
      join(sessionDir(dbOf(root), 'a1b2c3d4'), 'spawn.log'),
      'utf8',
    )
    expect(logged).toContain('stdout line')
    expect(logged).toContain('stderr line')
  },
)

test(
  [
    'given server/writes::startRun',
    'when the runtime is found',
    'it should spawn run.ts with the lifecycle, prompt, minted run id and extra args, carrying CRUST_DB (1.3.3)',
  ].join(', '),
  () => {
    // given
    const home = track(packageTree())
    const root = track(stampedTree(home))
    const spy = spawnSpy()
    const { spawnChild } = spy
    const env = { ...withHome(home), CRUST_DB: dbOf(root) }

    // when
    const actual = startRun(
      dbOf(root),
      root,
      'sdlc',
      'add a /health endpoint',
      ['--name', 'health'],
      env,
      spawnChild,
    )

    // then
    expect(actual.run_id).not.toBe('')
    expect(spy.calls[0]?.command).toBe('bun')
    expect(spy.calls[0]?.args).toEqual([
      join(home, 'runtime', 'commands', 'run.ts'),
      'add a /health endpoint',
      '--lifecycle',
      'sdlc',
      '--run-id',
      actual.run_id,
      '--name',
      'health',
    ])
    expect(spy.calls[0]?.options.cwd).toBe(root)
    expect(spy.calls[0]?.options.detached).toBe(true)
    expect(envOf(spy.calls[0]).CRUST_DB).toBe(dbOf(root))

    spy.calls[0]?.child.stdout.emit('data', 'stdout line\n')
    spy.calls[0]?.child.stderr.emit('data', 'stderr line\n')
    const logged = readFileSync(actual.log, 'utf8')
    expect(logged).toContain('stdout line')
    expect(logged).toContain('stderr line')
  },
)

test(
  [
    'given server/writes::isSafeSegment',
    'when the value is alphanumeric with dashes and underscores',
    'it should accept it as a path segment',
  ].join(', '),
  () => {
    // given
    // when
    const actual = isSafeSegment('a1b2_c3-d4')

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given server/writes::isSafeSegment',
    'when the value carries a path separator',
    'it should refuse it',
  ].join(', '),
  () => {
    // given
    // when
    const actual = isSafeSegment('../etc/passwd')

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given server/writes::isSafeSegment',
    'when the value is longer than 64 characters',
    'it should refuse it',
  ].join(', '),
  () => {
    // given
    const value = 'a'.repeat(65)

    // when
    const actual = isSafeSegment(value)

    // then
    expect(actual).toBe(false)
  },
)

/**
 * Borrow `process.env.CRUST_TOKEN` for the duration of `run`, then restore
 * whatever was there before — `refuseUnlessAuthorised` reads it directly
 * rather than through an injected parameter, so this is the only seam a
 * test has. Centralised here rather than repeated per test, matching
 * `runtime/commands/approve.test.ts`'s own pattern for borrowing an environment
 * variable: one assignment, one ignore, one reason.
 */
const withCrustToken = async (
  value: string | undefined,
  run: () => void | Promise<void>,
): Promise<void> => {
  const before = process.env.CRUST_TOKEN
  if (value === undefined) {
    delete process.env.CRUST_TOKEN
  } else {
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API refuseUnlessAuthorised reads through
    process.env.CRUST_TOKEN = value
  }
  try {
    await run()
  } finally {
    if (before === undefined) {
      delete process.env.CRUST_TOKEN
    } else {
      // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
      process.env.CRUST_TOKEN = before
    }
  }
}

test(
  [
    'given server/writes::refuseUnlessAuthorised',
    'when CRUST_TOKEN is not set',
    'it should refuse with 503, fail-closed',
  ].join(', '),
  async () => {
    await withCrustToken(undefined, async () => {
      // given
      const req = new Request('http://localhost/api/writes')

      // when
      const actual = refuseUnlessAuthorised(req)

      // then
      expect(actual?.status).toBe(503)
      const body = (await actual?.json()) as { error: string }
      expect(body.error).toContain('CRUST_TOKEN')
    })
  },
)

test(
  [
    'given server/writes::refuseUnlessAuthorised',
    'when the header matches CRUST_TOKEN',
    'it should return undefined, meaning the caller may write',
  ].join(', '),
  async () => {
    await withCrustToken('s3cret', () => {
      // given
      const req = new Request('http://localhost/api/writes', {
        headers: { [TOKEN_HEADER]: 's3cret' },
      })

      // when
      const actual = refuseUnlessAuthorised(req)

      // then
      expect(actual).toBeUndefined()
    })
  },
)

test(
  [
    'given server/writes::refuseUnlessAuthorised',
    'when the header does not match CRUST_TOKEN',
    'it should refuse with 401',
  ].join(', '),
  async () => {
    await withCrustToken('s3cret', async () => {
      // given
      const req = new Request('http://localhost/api/writes', {
        headers: { [TOKEN_HEADER]: 'wrong' },
      })

      // when
      const actual = refuseUnlessAuthorised(req)

      // then
      expect(actual?.status).toBe(401)
      const body = (await actual?.json()) as { error: string }
      expect(body.error).toBe('unauthorised')
    })
  },
)

test(
  [
    'given server/writes::startupFailure',
    'when only spawn.log carries content',
    'it should read it back',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())
    const dir = sessionDir(dbOf(root), 'a1b2c3d4')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spawn.log'), 'refused: no such Activity\n')

    // when
    const actual = startupFailure(dbOf(root), 'a1b2c3d4')

    // then
    expect(actual).toBe('refused: no such Activity')
  },
)

test(
  [
    'given server/writes::startupFailure',
    'when spawn.log and resume.log both carry content',
    'it should join them and keep only the last 12 lines',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())
    const dir = sessionDir(dbOf(root), 'a1b2c3d4')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spawn.log'), 'refused: no such Activity\n')
    writeFileSync(join(dir, 'resume.log'), 'line\n'.repeat(20))

    // when
    const actual = startupFailure(dbOf(root), 'a1b2c3d4')

    // then — spawn.log's one line plus resume.log's 20 is 21, so the oldest
    // lines (spawn.log's) fall off the trailing slice(-12)
    expect(actual?.split('\n')).toHaveLength(12)
    expect(actual).not.toContain('refused: no such Activity')
  },
)

test(
  [
    'given server/writes::startupFailure',
    'when neither log exists',
    'it should be undefined',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const actual = startupFailure(dbOf(root), 'a1b2c3d4')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given server/writes::isInboxKind',
    'when the value is one of steer, follow_up or abort',
    'it should accept it',
  ].join(', '),
  () => {
    // given
    // when / then
    expect(isInboxKind('steer')).toBe(true)
    expect(isInboxKind('follow_up')).toBe(true)
    expect(isInboxKind('abort')).toBe(true)
  },
)

test(
  [
    'given server/writes::isInboxKind',
    'when the value is not a recognised kind',
    'it should refuse it',
  ].join(', '),
  () => {
    // given
    // when / then
    expect(isInboxKind('nonsense')).toBe(false)
    expect(isInboxKind(42)).toBe(false)
  },
)

test(
  [
    'given server/writes::recordDecision',
    'when the action is approve with no text',
    'it should write just the approval line',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const path = recordDecision(dbOf(root), 'a1b2c3d4', 'approve', '', 'alice')

    // then
    expect(readFileSync(path, 'utf8')).toBe('Approved by alice.\n')
  },
)

test(
  [
    'given server/writes::recordDecision',
    'when the action is reject with text',
    'it should write the rejection and the reason',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const path = recordDecision(
      dbOf(root),
      'a1b2c3d4',
      'reject',
      'needs more tests',
      'alice',
    )

    // then
    expect(readFileSync(path, 'utf8')).toBe(
      'Rejected by alice.\n\nneeds more tests\n',
    )
  },
)

test(
  [
    'given server/writes::recordDecision',
    'when the action is answer',
    'it should write the text verbatim',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const path = recordDecision(
      dbOf(root),
      'a1b2c3d4',
      'answer',
      'yes, proceed',
      'alice',
    )

    // then
    expect(readFileSync(path, 'utf8')).toBe('yes, proceed\n')
  },
)

test(
  [
    'given server/writes::startConsult',
    'when the runtime cannot be found',
    'it should refuse and say so (1.3.5)',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const actual = startConsult(
      dbOf(root),
      root,
      'a1b2c3d4',
      'plan',
      'ask',
      'why?',
      withHome(),
    )

    // then
    expect(actual.started).toBe(false)
    expect(actual.reason).toBe(NO_RUNTIME)
  },
)

test(
  [
    'given server/writes::resumeRun',
    'when there is no invocation.json for the run',
    'it should refuse with a reason naming the run',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())

    // when
    const actual = resumeRun(dbOf(root), 'a1b2c3d4')

    // then
    expect(actual.resumed).toBe(false)
    expect(actual.reason).toBe(
      'no invocation.json for a1b2c3d4 — resume it by hand',
    )
  },
)

test(
  [
    'given server/writes::resumeRun',
    'when the recorded argv has no script at index 1',
    'it should refuse as unusable',
  ].join(', '),
  () => {
    // given
    const root = track(stampedTree())
    const dir = sessionDir(dbOf(root), 'a1b2c3d4')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'invocation.json'),
      JSON.stringify({ argv: ['bun'] }),
    )

    // when
    const actual = resumeRun(dbOf(root), 'a1b2c3d4')

    // then
    expect(actual.resumed).toBe(false)
    expect(actual.reason).toBe('recorded argv is unusable')
  },
)

for (const mode of ['recorded', 'fallback', 'gone', 'invalid'] as const) {
  test(
    [
      `given a working tree lookup with ${mode}`,
      'when a viewer action is requested',
      'it should use only an existing recorded or invocation working directory',
    ].join(', '),
    () => {
      // given
      const root = track(stampedTree())
      const missing = join(root, 'missing')
      writeFileSync(
        join(root, 'invocation.json'),
        mode === 'invalid'
          ? 'broken'
          : JSON.stringify({ cwd: mode === 'gone' ? missing : root }),
      )
      // when
      const actual = runWorkingTree(mode === 'recorded' ? root : missing, root)
      // then
      expect(actual).toBe(
        mode === 'recorded' || mode === 'fallback' ? root : undefined,
      )
    },
  )
}
for (const mode of [
  'override',
  'record',
  'missing',
  'no-entry',
  'no-cwd',
  'script',
] as const) {
  test(
    [
      `given a recorded run with ${mode}`,
      'when the viewer resumes it',
      'it should select the installation before spawning and carry the trace directory',
    ].join(', '),
    () => {
      // given
      const root = track(stampedTree())
      const home = track(packageTree())
      const session = sessionDir(dbOf(root), 'resume196')
      mkdirSync(session, { recursive: true })
      mkdirSync(join(home, 'runtime/commands'))
      if (mode !== 'no-entry')
        writeFileSync(join(home, 'runtime/commands/run.ts'), '')
      const script =
        mode === 'script'
          ? '/external/script.ts'
          : '/old/runtime/commands/run.ts'
      writeFileSync(
        join(session, 'invocation.json'),
        JSON.stringify({
          argv: ['bun', script, 'request'],
          ...(mode === 'no-cwd' ? {} : { cwd: root }),
        }),
      )
      if (mode === 'record')
        writeFileSync(join(root, '.pi-crust/pi-crust-home'), home)
      const env = {
        HOME: root,
        ...(mode === 'record' || mode === 'missing'
          ? {}
          : { CRUST_HOME: home }),
      }
      const spy = spawnSpy()
      // when
      const result = resumeRun(
        dbOf(root),
        'resume196',
        '',
        'tester',
        env,
        spy.spawnChild,
      )
      // then
      const starts = !['missing', 'no-entry', 'no-cwd'].includes(mode)
      expect(result.resumed).toBe(starts)
      expect(spy.calls.length).toBe(starts ? 1 : 0)
      if (starts) {
        expect(spy.calls[0]?.args[0]).toBe(
          mode === 'script' ? script : join(home, 'runtime/commands/run.ts'),
        )
        expect(spy.calls[0]?.options.cwd).toBe(root)
        expect(envOf(spy.calls[0]).CRUST_DATA_DIR).toBe(
          join(root, '.pi-crust/data'),
        )
        expect(envOf(spy.calls[0]).CRUST_DB).toBe(dbOf(root))
      }
      if (mode === 'missing') expect(result.reason).toBe(NO_RUNTIME)
      if (mode === 'no-entry')
        expect(result.reason).toBe(
          NO_ENTRY('resume196', script, join(home, 'runtime')),
        )
      expect(resumeEntry('/external/script.ts', join(home, 'runtime'))).toBe(
        '/external/script.ts',
      )
    },
  )
}
