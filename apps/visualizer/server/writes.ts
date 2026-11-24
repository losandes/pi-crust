/**
 * Everything this server can CHANGE, and the one gate in front of all of it.
 *
 * Reads are harmless: a trace is a record of what already happened. Writes are
 * not — they steer a running agent, answer a gate on your behalf, and start
 * runs that spend money. So they live in one file with one guard, rather than
 * being sprinkled through the route table where the next one added quietly
 * misses the check.
 *
 * ## Why the token is unconditional
 *
 * It would be convenient to skip it for localhost. It would also be wrong:
 * "the connection came from 127.0.0.1" is not an identity. Any page in any
 * browser on this machine can POST to localhost, and anything that can make
 * the server fetch a URL makes the loopback check meaningless. The cost of
 * being right is one header.
 *
 * Fail CLOSED: with no `CRUST_TOKEN` set, every write is refused. A server
 * that silently allowed writes because nobody configured a secret is the
 * failure this is here to prevent.
 */

import { Database } from 'bun:sqlite'
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { safeParseSettlement } from '@typedefs'
import { z } from 'zod'
import type { ApiError } from '../shared/types.ts'
import { handoffDirFor } from './handoff.ts'

export const TOKEN_HEADER = 'x-crust-token'

/** A run id is a path segment on disk; anything else is an attack or a typo. */
export const isSafeSegment = (value: string): boolean =>
  /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 64

const json = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

/**
 * Compare without leaking the answer in how long it took.
 *
 * Overkill for a local dashboard, and cheap enough that arguing about it costs
 * more than doing it.
 */
const sameSecret = (given: string, expected: string): boolean => {
  if (given.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < given.length; index += 1) {
    diff |= given.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

/** Undefined when the caller may write; a Response saying why when they may not. */
export const refuseUnlessAuthorised = (
  req: Readonly<Request>,
): Response | undefined => {
  const expected = (process.env.CRUST_TOKEN ?? '').trim()
  if (expected === '') {
    return json(
      {
        error:
          'writes are disabled: set CRUST_TOKEN on the server and send it as ' +
          `the ${TOKEN_HEADER} header`,
      } satisfies ApiError,
      503,
    )
  }
  const given = (req.headers.get(TOKEN_HEADER) ?? '').trim()
  return sameSecret(given, expected)
    ? undefined
    : json({ error: 'unauthorised' } satisfies ApiError, 401)
}

export const sessionDir = (dbPath: string, runId: string): string =>
  join(dirname(dbPath), 'sessions', runId)

/** The server locates its own package unless an explicit override is given. */
export const OWN_RUNTIME = resolve(import.meta.dir, '..', '..', '..', 'runtime')

export const crustRuntime = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  own: string = OWN_RUNTIME,
): string | undefined => {
  const configured = (env.CRUST_HOME ?? '').trim()
  const runtime = configured === '' ? own : join(configured, 'runtime')
  return existsSync(join(runtime, 'cli.ts')) ? runtime : undefined
}

/**
 * What to say when the runtime cannot be found, in the words the recipes use.
 *
 * Named here so steer, consult and start-a-run all refuse identically: the
 * repair is the same one in every case, and three phrasings of it would read
 * as three different problems.
 */
export const NO_RUNTIME =
  'cannot find pi-crust: CRUST_HOME names a directory without runtime/cli.ts. Unset CRUST_HOME, or set it to a pi-crust checkout.'
export const NO_WORKING_TREE = (runId: string): string =>
  `cannot act on ${runId}: its working tree is not recorded or no longer exists`
export const NO_ENTRY = (
  runId: string,
  recorded: string,
  runtime: string,
): string =>
  `cannot resume ${runId}: ${recorded} is not an entry point of the pi-crust at ${dirname(runtime)}`

const existingDirectory = (path: unknown): path is string =>
  typeof path === 'string' && existsSync(path) && statSync(path).isDirectory()

export const runWorkingTree = (
  workspaceRoot: string | undefined,
  sessionDirectory: string,
): string | undefined => {
  if (existingDirectory(workspaceRoot)) return workspaceRoot
  const invocation = safeParseSettlement(() => {
    const parsed = z
      .object({ cwd: z.string() })
      .safeParse(
        JSON.parse(
          readFileSync(join(sessionDirectory, 'invocation.json'), 'utf8'),
        ),
      )
    return parsed.success && existingDirectory(parsed.data.cwd)
      ? parsed.data.cwd
      : undefined
  })
  return invocation.status === 'ok' ? invocation.data : undefined
}

export const resumeEntry = (
  recorded: string,
  runtime: string,
): string | undefined => {
  const parts = recorded.split('/')
  const index = parts.lastIndexOf('runtime')
  if (index < 0) return recorded
  const path = join(runtime, ...parts.slice(index + 1))
  return existsSync(path) && statSync(path).isFile() ? path : undefined
}

/**
 * Why a run that was started has no session row.
 *
 * A run can be REFUSED before it opens a session: a concurrent Stage whose
 * Activities declare overlapping `writes` is rejected at load, and so is an
 * unknown Activity name. The process exits 2 having written the reason to the
 * session's spawn log, and nothing in the trace records that it ever existed.
 *
 * Read from the log rather than inferred, because the reason is the whole
 * value: "refused" tells a reader nothing they cannot see from the absence.
 */
export const startupFailure = (
  dbPath: string,
  runId: string,
): string | undefined => {
  const logs = ['spawn.log', 'resume.log']
    .map((name) => join(sessionDir(dbPath, runId), name))
    .filter((path) => existsSync(path))
  const text = logs
    .map((path) => readFileSync(path, 'utf8').trim())
    .filter((contents) => contents !== '')
    .join('\n')

  return text === '' ? undefined : text.split('\n').slice(-12).join('\n')
}

export type TInboxKind = 'steer' | 'follow_up' | 'abort'

const KINDS: readonly string[] = ['steer', 'follow_up', 'abort']

/**
 * Post a message to a running agent's inbox.
 *
 * The same append-only file the factory's own `inbox.ts` reads, written in the
 * same shape. Two implementations of one format is a real risk, and the
 * alternative — importing across the skill boundary into a stamped tree whose
 * path this process cannot know — is worse. The format is four fields and a
 * newline, and both sides have tests.
 */
export const postMessage = (
  dbPath: string,
  runId: string,
  kind: TInboxKind,
  message: string,
  from: string,
): Readonly<{
  kind: TInboxKind
  message: string
  at: string
  from: string
}> => {
  const dir = sessionDir(dbPath, runId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const entry = { kind, message, at: new Date().toISOString(), from }
  appendFileSync(join(dir, 'inbox.jsonl'), `${JSON.stringify(entry)}\n`)
  return entry
}

export const isInboxKind = (value: unknown): value is TInboxKind =>
  typeof value === 'string' && KINDS.includes(value)

/**
 * Record a gate decision where the waiting run will find it.
 *
 * Deliberately the same files `decide.ts` writes, because a run must not care
 * which surface answered it.
 */
export const recordDecision = (
  dbPath: string,
  runId: string,
  action: 'approve' | 'reject' | 'answer',
  text: string,
  from: string,
): string => {
  const handoff = handoffDirFor(join(dirname(dbPath), 'sessions'), runId)
  if (!existsSync(handoff)) mkdirSync(handoff, { recursive: true })
  const body =
    action === 'approve'
      ? `Approved by ${from}.${text === '' ? '' : `\n\n${text}`}\n`
      : action === 'reject'
        ? `Rejected by ${from}.\n\n${text}\n`
        : `${text}\n`
  const path = join(handoff, 'decision-answer.md')
  writeFileSync(path, body, 'utf8')
  writeFileSync(
    join(handoff, 'decision-answer.json'),
    `${JSON.stringify({
      verb: action,
      at: new Date().toISOString(),
      from,
    })}\n`,
    'utf8',
  )
  return path
}

/**
 * Send a run back to a activity with new instructions.
 *
 * Detached: the replay is the rest of the run, which may be an hour. The
 * target is passed through as the flag the CLI requires rather than a
 * default chosen here — one of the two discards the path being steered away
 * from, and the server is not the place that decides which.
 *
 * A branch is always seeded `fork`: the dialog that offers branch at all is
 * designed around one deliberate choice, and `TSeeding`'s own documentation
 * says fork is usually what you want because the rejected attempt is WHY
 * somebody is steering. `fresh` stays a CLI-only choice.
 *
 * `branchRunId` is minted by the CALLER — `/steer`, following `startRun`'s
 * own pattern — because this detaches: the HTTP response cannot wait to
 * learn what the child decided, so the id has to exist before it is asked
 * to write anything.
 */
export const startSteer = (
  dbPath: string,
  cwd: string,
  runId: string,
  activity: string,
  target: 'overwrite' | 'branch',
  note: string,
  branchRunId?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnChild: typeof spawn = spawn,
): Readonly<{
  started: boolean
  pid: number | undefined
  log: string
  reason?: string
  branch_run_id: string
}> => {
  const runtime = crustRuntime(env)
  if (runtime === undefined) {
    return {
      started: false,
      pid: undefined,
      log: '',
      reason: NO_RUNTIME,
      branch_run_id: target === 'branch' ? (branchRunId ?? '') : '',
    }
  }
  const dir = sessionDir(dbPath, runId)
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'steer.log')
  const args =
    target === 'branch'
      ? [
          join(runtime, 'commands', 'steer.ts'),
          runId,
          activity,
          '--branch',
          '--seeding',
          'fork',
          '--branch-id',
          branchRunId ?? '',
          note,
        ]
      : [
          join(runtime, 'commands', 'steer.ts'),
          runId,
          activity,
          '--overwrite',
          note,
        ]
  const child = spawnChild('bun', args, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, CRUST_DB: dbPath, CRUST_DATA_DIR: dirname(dbPath) },
  })
  child.stdout?.on('data', (chunk) => appendFileSync(log, chunk))
  child.stderr?.on('data', (chunk) => appendFileSync(log, chunk))
  child.unref()
  return {
    started: true,
    pid: child.pid,
    log,
    reason: '',
    branch_run_id: target === 'branch' ? (branchRunId ?? '') : '',
  }
}

/**
 * Put a question to a finished activity, or ask it to amend its own document.
 *
 * Detached, like resuming. A consult rejoins a conversation that may be a
 * hundred thousand tokens and takes a minute to answer, while an HTTP
 * handler has milliseconds. The answer is not returned here: the CLI records
 * it against the activityRun, and the UI is already polling events, so it arrives
 * the way everything else a run produces arrives.
 *
 * The run's own tree is the cwd, because a activity's question is usually about
 * the repository it was reasoning over.
 */
export const startConsult = (
  dbPath: string,
  cwd: string,
  runId: string,
  activity: string,
  mode: 'ask' | 'amend',
  question: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnChild: typeof spawn = spawn,
): Readonly<{
  started: boolean
  pid: number | undefined
  log: string
  reason?: string
}> => {
  const runtime = crustRuntime(env)
  if (runtime === undefined) {
    return { started: false, pid: undefined, log: '', reason: NO_RUNTIME }
  }
  const dir = sessionDir(dbPath, runId)
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'consult.log')
  const child = spawnChild(
    'bun',
    [join(runtime, 'commands', `${mode}.ts`), runId, activity, question],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The consult must read the SAME trace this server is serving, which
      // is not necessarily the one its cwd would resolve to.
      env: { ...env, CRUST_DB: dbPath, CRUST_DATA_DIR: dirname(dbPath) },
    },
  )
  child.stdout?.on('data', (chunk) => appendFileSync(log, chunk))
  child.stderr?.on('data', (chunk) => appendFileSync(log, chunk))
  child.unref()
  return { started: true, pid: child.pid, log, reason: '' }
}

/**
 * The standing instruction a developer leaves when picking a run back up, in
 * the exact shape `runtime/domains/handoff/src/use-cases/steer.ts::developerNote` writes
 * it — see `writes.test.ts` for the test pinning both sides to the same
 * literal, since there is no import that would be correct here: this server
 * resolves whatever workspace it is pointed at, and `runtime/` ships with
 * the package rather than with the stamp.
 */
const developerNoteEntry = (note: string, at: string): string =>
  [`## Instruction from the developer at ${at}`, '', note.trim(), ''].join('\n')

/**
 * Append a developer's note to the run's own `steering.md`, through the
 * handoff directory the run actually recorded, independently of package discovery.
 */
const recordResumeNote = (
  dbPath: string,
  runId: string,
  note: string,
  from: string,
): string => {
  const handoff = handoffDirFor(join(dirname(dbPath), 'sessions'), runId)
  if (!existsSync(handoff)) mkdirSync(handoff, { recursive: true })
  const path = join(handoff, 'steering.md')
  const entry = developerNoteEntry(note, new Date().toISOString())
  appendFileSync(path, entry.endsWith('\n') ? entry : `${entry}\n`)

  const db = new Database(dbPath)
  db.run('PRAGMA busy_timeout=5000;')
  db.run(
    'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
      ' VALUES (?,?,?,?,?,?)',
    [
      `evt_note_${Date.now()}`,
      runId,
      'log',
      'developer_note',
      JSON.stringify({
        note,
        from,
        at: new Date().toISOString(),
        recorded: path,
      }),
      new Date().toISOString(),
    ],
  )
  db.close()
  return path
}

/**
 * Pick a waiting run back up, exactly as it was launched.
 *
 * Approve, reject and answer all MEAN "carry on" — a person who has just told
 * a run what to do has not asked to be given a command to type. Recording the
 * decision and then waiting for a second action was a design error: two
 * clicks for one intention.
 *
 * The argv comes from the `invocation.json` the run wrote at startup, because
 * the flags are not otherwise recoverable: `--approve-after plan` exists only
 * in argv, and the processes table stores the command space-joined, which
 * loses the boundaries of a prompt containing spaces.
 *
 * A non-empty `note` is appended to `steering.md` BEFORE the run is spawned,
 * so every activity from here reads it through the steering block
 * `execute-agent.ts` already splices into every prompt. An empty note keeps
 * today's behaviour byte-for-byte: no file is written, and `note_recorded`
 * comes back `''`.
 */
export const resumeRun = (
  dbPath: string,
  runId: string,
  note = '',
  from = 'the web app',
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnChild: typeof spawn = spawn,
): Readonly<{
  resumed: boolean
  pid: number | undefined
  reason: string
  note_recorded: string
}> => {
  const noteRecorded =
    note.trim() === '' ? '' : recordResumeNote(dbPath, runId, note.trim(), from)
  const recorded = join(sessionDir(dbPath, runId), 'invocation.json')
  if (!existsSync(recorded)) {
    return {
      resumed: false,
      pid: undefined,
      reason: `no invocation.json for ${runId} — resume it by hand`,
      note_recorded: noteRecorded,
    }
  }
  const parsed = JSON.parse(readFileSync(recorded, 'utf8')) as {
    argv?: unknown
    cwd?: unknown
  }
  const argv = Array.isArray(parsed.argv)
    ? parsed.argv.filter((part): part is string => typeof part === 'string')
    : []
  const script = argv[1] ?? ''
  if (script === '') {
    return {
      resumed: false,
      pid: undefined,
      reason: 'recorded argv is unusable',
      note_recorded: noteRecorded,
    }
  }
  // The run's own resume flags are stripped and re-appended, so resuming a
  // run that was already resumed does not stack duplicates onto the line.
  const carried = argv
    .slice(2)
    .filter(
      (arg, index, all) =>
        arg !== '--run-id' &&
        all[index - 1] !== '--run-id' &&
        arg !== '--resume',
    )
  if (typeof parsed.cwd !== 'string')
    return {
      resumed: false,
      pid: undefined,
      reason: `invocation.json for ${runId} records no working directory`,
      note_recorded: noteRecorded,
    }
  const runtime = crustRuntime(env)
  if (runtime === undefined)
    return {
      resumed: false,
      pid: undefined,
      reason: NO_RUNTIME,
      note_recorded: noteRecorded,
    }
  const entry = resumeEntry(script, runtime)
  if (entry === undefined)
    return {
      resumed: false,
      pid: undefined,
      reason: NO_ENTRY(runId, script, runtime),
      note_recorded: noteRecorded,
    }
  const cwd = parsed.cwd
  // Detached, and it must stay that way. The terminal path attaches, because
  // somebody typed `approve` and is waiting; an HTTP handler has to answer in
  // milliseconds and has no terminal to attach to, so the run outlives the
  // request and its output goes to the session's own log.
  const log = join(sessionDir(dbPath, runId), 'spawn.log')
  const child = spawnChild(
    'bun',
    [entry, ...carried, '--run-id', runId, '--resume'],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, CRUST_DB: dbPath, CRUST_DATA_DIR: dirname(dbPath) },
    },
  )
  child.stdout?.on('data', (chunk) => appendFileSync(log, chunk))
  child.stderr?.on('data', (chunk) => appendFileSync(log, chunk))
  child.unref()
  return {
    resumed: true,
    pid: child.pid,
    reason: '',
    note_recorded: noteRecorded,
  }
}

/**
 * Start a Lifecycle, detached, and hand back the run id it will use.
 *
 * Through the Composer, naming the Lifecycle: there has been no file per
 * Lifecycle since the DAG landed, and there is no runtime in the stamp to
 * hold one if there were. The Composer reads the merged TOML lifecycle tables,
 * so a Lifecycle that repository or machine added is startable from here
 * with no change on this side.
 *
 * Detached and with its output to a file rather than to this process: a run
 * outlives the request that asked for it, and a server that held the pipe
 * would stall the run the moment nobody was reading. The id is generated here
 * so the response can say where to watch before the child has written a row.
 */
export const startRun = (
  dbPath: string,
  cwd: string,
  lifecycle: string,
  prompt: string,
  extraArgs: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnChild: typeof spawn = spawn,
): Readonly<{
  run_id: string
  pid: number | undefined
  log: string
  reason?: string
}> => {
  const runtime = crustRuntime(env)
  if (runtime === undefined) {
    return { run_id: '', pid: undefined, log: '', reason: NO_RUNTIME }
  }
  const runId = Math.random().toString(16).slice(2, 10)
  const logDir = join(dirname(dbPath), 'sessions', runId)
  mkdirSync(logDir, { recursive: true })
  const log = join(logDir, 'spawn.log')
  writeFileSync(log, '', 'utf8')
  const child = spawnChild(
    'bun',
    [
      join(runtime, 'commands', 'run.ts'),
      prompt,
      '--lifecycle',
      lifecycle,
      '--run-id',
      runId,
      ...extraArgs,
    ],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, CRUST_DB: dbPath, CRUST_DATA_DIR: dirname(dbPath) },
    },
  )
  child.stdout?.on('data', (chunk) => appendFileSync(log, chunk))
  child.stderr?.on('data', (chunk) => appendFileSync(log, chunk))
  child.unref()
  return { run_id: runId, pid: child.pid, log, reason: '' }
}
