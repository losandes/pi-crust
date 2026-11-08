#!/usr/bin/env bun

/**
 * Ask a finished activity a question, or let it amend its own document.
 *
 *   just crust ask   <run-id> <activity> "question"
 *   just crust amend <run-id> <activity> "what to change"
 *
 * A activity's conversation outlives the activity: pi keeps it as a session and a
 * later process rejoins it by id, so the agent answers with everything it
 * knew rather than re-deriving it. Neither mode opens an activity run — a consult is
 * something that happened TO a activity, not a activity of its own.
 *
 * `ask` has no writing tools. `amend` may rewrite the documents that activity
 * wrote and nothing else: every other activity's are read-only, and anything
 * changed anyway is restored and reported.
 *
 * env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.
 */

import { Database } from 'bun:sqlite'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { safeParseSettlement } from '../lib/typedefs/src/settlement'
import { loadConfig } from './domains/config'
import {
  consultArgv,
  consultEvent,
  handoffDirFor,
  runConsult,
  sessionDirFor,
  type TConsultMode,
  type TConsultRequest,
} from './domains/handoff'
import { createTracer } from './domains/trace'
import { DEFAULT_DB } from './lib/contracts'
import { configPathFromEnv, dbPathFromEnv } from './lib/system'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const USAGE =
  'usage: just crust <ask|amend> <run-id> <activity> "question"\n' +
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.'

/** The latest activityRun of this run with that activity name, and who owned it. */
const activityRunOf = (
  db: Database,
  runId: string,
  activity: string,
): Readonly<{ activity_run_id: string; owner: string }> | undefined =>
  db
    .query<{ activity_run_id: string; owner: string }, [string, string]>(
      `SELECT activity_run_id, owner FROM activity_runs
        WHERE run_id = ? AND name = ? AND owner IS NOT NULL
        ORDER BY seq DESC, rowid DESC LIMIT 1`,
    )
    .get(runId, activity) ?? undefined

/** The session that agent left behind, and the model it was speaking as. */
const sessionOf = (
  db: Database,
  runId: string,
  agent: string,
): Readonly<{ session_id: string; model: string }> | undefined =>
  db
    .query<{ session_id: string; model: string }, [string, string]>(
      'SELECT session_id, model FROM agent_sessions WHERE run_id = ? AND agent = ?',
    )
    .get(runId, agent) ?? undefined

/**
 * The documents that activityRun was OBSERVED to create.
 *
 * Observed rather than reported, because this decides what an amend may
 * overwrite: a claim is the agent's word, and ownership has to rest on what
 * actually happened.
 */
const ownedBy = (db: Database, activityRunId: string): readonly string[] =>
  db
    .query<{ payload_json: string | null }, [string]>(
      "SELECT payload_json FROM events WHERE activity_run_id = ? AND type = 'artifacts'",
    )
    .all(activityRunId)
    .flatMap((row) => {
      // An unreadable row claims nothing, which is what the catch decided.
      const settled = safeParseSettlement(
        () =>
          (JSON.parse(row.payload_json ?? '{}') as { created?: unknown })
            .created,
      )
      const created = settled.status === 'ok' ? settled.data : undefined
      return Array.isArray(created)
        ? created.filter((item): item is string => typeof item === 'string')
        : []
    })

const invoke = async (
  argv: readonly string[],
  cwd: string,
): Promise<Readonly<{ ok: boolean; output: string }>> =>
  new Promise((settle) => {
    const [binary, ...rest] = argv
    /*
     * stdin IGNORED, deliberately. With the default pipe, pi's print mode
     * waits on a stdin that nobody is going to close and the consult hangs
     * forever — observed as a 600-second timeout against a real run, where
     * the same argv from a terminal answered in seconds.
     */
    const child = spawn(binary ?? 'pi', rest, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // The joined text, accumulated as text: `chunks.join('')` was the only
    // thing the array was ever used for.
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('close', (code) => settle({ ok: code === 0, output }))
  })

const main = async (): Promise<number> => {
  const [mode, runId, activity, ...rest] = process.argv.slice(2)
  const question = rest.join(' ').trim()
  if (
    (mode !== 'ask' && mode !== 'amend') ||
    runId === undefined ||
    activity === undefined ||
    question === ''
  ) {
    say(USAGE)
    return 2
  }

  const configPath = configPathFromEnv()
  const cfg = loadConfig(configPath)
  const dbPath = resolve(dbPathFromEnv() ?? cfg.observability.db ?? DEFAULT_DB)
  const dataDir = resolve(dirname(dirname(dbPath)), 'data')

  const db = new Database(dbPath, { readonly: true })
  const activityRun = activityRunOf(db, runId, activity)
  if (activityRun === undefined) {
    say(`no activity "${activity}" in run ${runId}`)
    db.close()
    return 1
  }
  const session = sessionOf(db, runId, activityRun.owner)
  if (session === undefined) {
    say(`no recorded session for ${activityRun.owner} in run ${runId}`)
    db.close()
    return 1
  }
  const own = ownedBy(db, activityRun.activity_run_id)
  db.close()

  const handoffDir = handoffDirFor(dataDir, runId)
  const request: TConsultRequest = {
    runId,
    activityRunId: activityRun.activity_run_id,
    agent: activityRun.owner,
    sessionId: session.session_id,
    sessionDir: sessionDirFor(dataDir, runId, activityRun.owner),
    handoffDir,
    mode: mode as TConsultMode,
    // What the person asked, verbatim. The preamble that tells the agent
    // which mode this is rides in the argv, so the record stays the
    // question rather than the question plus machinery.
    question,
    own,
  }

  const [provider = 'anthropic', modelId = session.model] = (
    session.model ?? ''
  ).split('/')
  const argv = consultArgv(
    request,
    { provider, modelId },
    process.env.PI_PATH ?? 'pi',
  )

  say(`${mode} → ${activityRun.owner} (${activity}) in run ${runId}`)
  const outcome = await runConsult(
    request,
    (line) => invoke(line, process.cwd()),
    argv,
  )

  if (!outcome.answered) {
    say(outcome.reason)
    return 1
  }

  // Recorded against the activityRun it asked about, so the thread is found where
  // the question made sense rather than at the end of the run.
  const tracer = createTracer(
    dbPath,
    resolve(dataDir, 'sessions', runId, 'events.jsonl'),
  )
  const event = consultEvent(request, outcome)
  tracer.event({
    run_id: runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'consult',
    name: event.name,
    payload: event.payload,
  })
  tracer.close()

  say('')
  say(outcome.answer)
  if (outcome.amended.length > 0) {
    say('')
    say(`amended: ${outcome.amended.join(', ')}`)
    say(
      'activities after this one already ran against the previous version — the ' +
        'trace marks them, acting on it is your call.',
    )
  }
  if (outcome.restored.length > 0) {
    say(
      `restored (belonged to another activity): ${outcome.restored.join(', ')}`,
    )
  }
  return 0
}

process.exitCode = await main()
