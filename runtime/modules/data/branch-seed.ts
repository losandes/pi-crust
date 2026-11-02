/**
 * Seeding a branch: the one effectful module `--branch` needs.
 *
 * A branch is an ordinary resumed run that happens to start from a copy
 * rather than from the run it is copying. `resumeArgv`/`--resume` already
 * define "ordinary" — skip a activity whose latest row succeeded, replay the
 * rest — so seeding a branch means writing exactly the rows and files that
 * make `readRunState` say the same thing about the branch that it says about
 * the source, up to the branch point.
 *
 * Trace rows are copied rather than re-derived because `replayQuality` and
 * `replayCommit` read a previous verdict out of the trace: an activity-run
 * row with no `events`/`envelopes` under it is a row resume cannot actually
 * replay from.
 */

import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { cpSync, existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { defaultHandoffDir } from '../use-cases/handoff-location'
import { INVOCATION_FILENAME } from '../use-cases/resume-run'
import type { TSeeding } from '../use-cases/steer'
import { fileExists, readText, writeText } from './files'
import { handoffDirFor, writeHandoffPointer } from './handoff-pointer'
import { newId } from './ids'

export type TBranchSeed = Readonly<{
  dbPath: string
  dataDir: string
  sourceRunId: string
  branchRunId: string
  /** activity_run_ids inherited verbatim, from activityRunsToCarry */
  carry: readonly string[]
  seeding: TSeeding
  at: string
}>

export type TBranchSeeded = Readonly<{
  branchRunId: string
  sessionDir: string
  handoffDir: string
  /** activity names the branch will skip on resume */
  carried: readonly string[]
}>

/** Optional `sessions` columns this code knows about, carried when present. */
const OPTIONAL_SESSION_COLUMNS = [
  'lifecycle',
  'request',
  'engineer',
  'workspace_root',
  'branch',
  'vcs_root',
  'name',
] as const

const sessionColumnsPresent = (db: Database): readonly string[] => {
  const present = new Set(
    db
      .query<{ name: string }, []>('PRAGMA table_info(sessions)')
      .all()
      .map((row) => row.name),
  )
  return OPTIONAL_SESSION_COLUMNS.filter((column) => present.has(column))
}

const asBinding = (value: unknown): SQLQueryBindings =>
  value === undefined ? null : (value as SQLQueryBindings)

const seedSessionRow = (
  db: Database,
  sourceRunId: string,
  branchRunId: string,
  at: string,
): void => {
  const columns = sessionColumnsPresent(db)
  const source = db
    .query<Record<string, unknown>, [string]>(
      `SELECT ${columns.join(', ')} FROM sessions WHERE run_id=?`,
    )
    .get(sourceRunId)
  const values = columns.map((column) => asBinding(source?.[column] ?? null))
  db.run(
    `INSERT INTO sessions (run_id, status, started_at, ended_at, total_tokens,` +
      ` total_cost, archived, ${columns.join(', ')}) VALUES (?,?,?,?,?,?,?,` +
      `${columns.map(() => '?').join(',')})`,
    [branchRunId, 'running', at, null, 0, 0, 0, ...values],
  )
}

type TActivityRunRow = Readonly<{
  activity_run_id: string
  seq: number
  name: string
  kind: string
  owner: string
  description: string | null
  status: string
  error: string | null
  started_at: string | null
  ended_at: string | null
}>

/** Inherited activity_runs, remapped to fresh ids. Returns old-id -> new-id. */
const seedActivityRuns = (
  db: Database,
  sourceRunId: string,
  branchRunId: string,
  carry: readonly string[],
): ReadonlyMap<string, string> => {
  const idMap = new Map<string, string>()
  if (carry.length === 0) return idMap
  const ids: string[] = [...carry]
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .query<TActivityRunRow, string[]>(
      `SELECT activity_run_id, seq, name, kind, owner, description, status,` +
        ` error, started_at, ended_at FROM activity_runs` +
        ` WHERE run_id=? AND activity_run_id IN (${placeholders})`,
    )
    .all(sourceRunId, ...ids)
  for (const row of rows) {
    const newId_ = `arn_${newId(12)}`
    idMap.set(row.activity_run_id, newId_)
    db.run(
      `INSERT INTO activity_runs (activity_run_id, run_id, seq, name, kind, owner,` +
        ` description, status, error, started_at, ended_at)` +
        ` VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newId_,
        branchRunId,
        row.seq,
        row.name,
        row.kind,
        row.owner,
        row.description,
        row.status,
        row.error,
        row.started_at,
        row.ended_at,
      ],
    )
  }
  return idMap
}

const seedEvents = (
  db: Database,
  sourceRunId: string,
  branchRunId: string,
  idMap: ReadonlyMap<string, string>,
): void => {
  if (idMap.size === 0) return
  const oldIds: string[] = [...idMap.keys()]
  const placeholders = oldIds.map(() => '?').join(',')
  const rows = db
    .query<
      Readonly<{
        activity_run_id: string
        parent_id: string | null
        type: string
        name: string
        payload_json: string | null
        tokens: number | null
        started_at: string | null
        ended_at: string | null
      }>,
      string[]
    >(
      `SELECT activity_run_id, parent_id, type, name, payload_json, tokens,` +
        ` started_at, ended_at FROM events` +
        ` WHERE run_id=? AND activity_run_id IN (${placeholders})`,
    )
    .all(sourceRunId, ...oldIds)
  for (const row of rows) {
    db.run(
      `INSERT INTO events (event_id, run_id, activity_run_id, parent_id, type, name,` +
        ` payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        `evt_${newId(12)}`,
        branchRunId,
        idMap.get(row.activity_run_id) ?? row.activity_run_id,
        row.parent_id,
        row.type,
        row.name,
        row.payload_json,
        row.tokens,
        row.started_at,
        row.ended_at,
      ],
    )
  }
}

const seedEnvelopes = (
  db: Database,
  sourceRunId: string,
  branchRunId: string,
  idMap: ReadonlyMap<string, string>,
): void => {
  if (idMap.size === 0) return
  const oldIds: string[] = [...idMap.keys()]
  const placeholders = oldIds.map(() => '?').join(',')
  const rows = db
    .query<
      Readonly<{
        activity_run_id: string
        agent: string
        output_type: string
        payload_json: string | null
        valid: number
        created_at: string | null
      }>,
      string[]
    >(
      `SELECT activity_run_id, agent, output_type, payload_json, valid, created_at` +
        ` FROM envelopes WHERE run_id=? AND activity_run_id IN (${placeholders})`,
    )
    .all(sourceRunId, ...oldIds)
  for (const row of rows) {
    db.run(
      `INSERT INTO envelopes (envelope_id, run_id, activity_run_id, agent, output_type,` +
        ` payload_json, valid, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [
        `env_${newId(12)}`,
        branchRunId,
        idMap.get(row.activity_run_id) ?? row.activity_run_id,
        row.agent,
        row.output_type,
        row.payload_json,
        row.valid,
        row.created_at,
      ],
    )
  }
}

const seedGateResults = (
  db: Database,
  sourceRunId: string,
  branchRunId: string,
  idMap: ReadonlyMap<string, string>,
): void => {
  if (idMap.size === 0) return
  const oldIds: string[] = [...idMap.keys()]
  const placeholders = oldIds.map(() => '?').join(',')
  const rows = db
    .query<
      Readonly<{
        activity_run_id: string
        gate: string
        passed: number
        violations_json: string | null
        checks_json: string | null
        created_at: string | null
      }>,
      string[]
    >(
      `SELECT activity_run_id, gate, passed, violations_json, checks_json, created_at` +
        ` FROM gate_results WHERE run_id=? AND activity_run_id IN (${placeholders})`,
    )
    .all(sourceRunId, ...oldIds)
  for (const row of rows) {
    db.run(
      `INSERT INTO gate_results (run_id, activity_run_id, gate, passed,` +
        ` violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?)`,
      [
        branchRunId,
        idMap.get(row.activity_run_id) ?? row.activity_run_id,
        row.gate,
        row.passed,
        row.violations_json,
        row.checks_json,
        row.created_at,
      ],
    )
  }
}

const seedAgentSessions = (
  db: Database,
  sourceRunId: string,
  branchRunId: string,
): void => {
  const rows = db
    .query<Record<string, unknown>, [string]>(
      `SELECT agent, coding_agent, model, color, session_id, context_tokens,` +
        ` context_window, created_at, last_used_at FROM agent_sessions WHERE run_id=?`,
    )
    .all(sourceRunId)
  for (const row of rows) {
    db.run(
      `INSERT INTO agent_sessions (run_id, agent, coding_agent, model, color,` +
        ` session_id, context_tokens, context_window, created_at, last_used_at)` +
        ` VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        branchRunId,
        asBinding(row.agent),
        asBinding(row.coding_agent),
        asBinding(row.model),
        asBinding(row.color),
        asBinding(row.session_id),
        asBinding(row.context_tokens),
        asBinding(row.context_window),
        asBinding(row.created_at),
        asBinding(row.last_used_at),
      ],
    )
  }
}

/**
 * Copy the session directory, excluding what belongs to the source's OWN
 * process rather than to the conversation a branch is meant to inherit.
 *
 * `fresh` additionally drops `agent_map.json` and every `pi_sessions/`
 * directory, but never `envelope.json` — `replayAgent` reads that off disk
 * for an inherited activity under either seeding.
 */
const copySessionDir = (
  sourceDir: string,
  branchDir: string,
  seeding: TSeeding,
): void => {
  if (!existsSync(sourceDir)) return
  cpSync(sourceDir, branchDir, {
    recursive: true,
    filter: (src: string): boolean => {
      const rel = relative(sourceDir, src)
      if (rel === '') return true
      if (
        rel === 'events.jsonl' ||
        rel === 'inbox.jsonl' ||
        rel === 'handoff-dir'
      ) {
        return false
      }
      if (basename(rel).endsWith('.log')) return false
      if (seeding === 'fresh') {
        if (rel === 'agent_map.json') return false
        if (rel.split('/').includes('pi_sessions')) return false
      }
      return true
    },
  })
}

/** Rewrite the branch's own invocation.json: strip `--handoff`, keep `cwd`. */
const rewriteInvocation = (branchSessionDir: string): void => {
  const path = join(branchSessionDir, INVOCATION_FILENAME)
  if (!fileExists(path)) return
  const parsed: unknown = JSON.parse(readText(path))
  if (parsed === null || typeof parsed !== 'object') return
  const record = parsed as { argv?: unknown; cwd?: unknown }
  const argv = Array.isArray(record.argv)
    ? record.argv.filter((part): part is string => typeof part === 'string')
    : []
  const stripped = argv.filter(
    (arg, index) => arg !== '--handoff' && argv[index - 1] !== '--handoff',
  )
  writeText(
    path,
    `${JSON.stringify({ argv: stripped, cwd: record.cwd ?? process.cwd() }, null, 2)}\n`,
  )
}

export const seedBranch = (seed: TBranchSeed): TBranchSeeded => {
  const { dbPath, dataDir, sourceRunId, branchRunId, carry, seeding, at } = seed
  const db = new Database(dbPath)
  db.run('PRAGMA busy_timeout=5000;')

  let carriedNames: readonly string[] = []
  db.transaction(() => {
    seedSessionRow(db, sourceRunId, branchRunId, at)
    const idMap = seedActivityRuns(db, sourceRunId, branchRunId, carry)
    carriedNames = db
      .query<{ name: string }, [string]>(
        `SELECT name FROM activity_runs WHERE run_id=?`,
      )
      .all(branchRunId)
      .map((row) => row.name)
    seedEvents(db, sourceRunId, branchRunId, idMap)
    seedEnvelopes(db, sourceRunId, branchRunId, idMap)
    seedGateResults(db, sourceRunId, branchRunId, idMap)
    if (seeding === 'fork') {
      seedAgentSessions(db, sourceRunId, branchRunId)
    }
  })()
  db.close()

  const sourceSessionDir = join(dataDir, 'sessions', sourceRunId)
  const branchSessionDir = join(dataDir, 'sessions', branchRunId)
  copySessionDir(sourceSessionDir, branchSessionDir, seeding)

  const sourceHandoffDir = handoffDirFor(dataDir, sourceRunId)
  const branchHandoffDir = defaultHandoffDir(dataDir, branchRunId)
  if (existsSync(sourceHandoffDir)) {
    cpSync(sourceHandoffDir, branchHandoffDir, { recursive: true })
  }
  writeHandoffPointer(branchSessionDir, branchHandoffDir)
  rewriteInvocation(branchSessionDir)

  return {
    branchRunId,
    sessionDir: branchSessionDir,
    handoffDir: branchHandoffDir,
    carried: carriedNames,
  }
}
