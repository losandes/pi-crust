/**
 * Reading the trace back out — the one read path over `crust.db`.
 *
 * Opened READONLY, with a busy timeout, so asking where a run got to can never
 * block or corrupt a run that is still writing. The tracer in `trace-db.ts` is
 * write-only by design; this is its mirror, and it creates nothing — a db that
 * does not exist yet is a question with no answer, not an error to recover
 * from.
 */

import { Database } from 'bun:sqlite'
import { fileExists } from './files'

export type TTraceSessionRow = Readonly<{
  run_id: string
  lifecycle: string | null
  request: string | null
  status: string | null
  engineer: string | null
  started_at: string | null
  ended_at: string | null
  total_tokens: number | null
  total_cost: number | null
  name: string | null
}>

export type TTraceActivityRunRow = Readonly<{
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

export type TTraceEventRow = Readonly<{
  activity_run_id: string | null
  type: string
  name: string
  payload_json: string | null
  started_at: string | null
}>

export type TTraceEnvelopeRow = Readonly<{
  activity_run_id: string | null
  agent: string
  output_type: string
  payload_json: string | null
  valid: number
  created_at: string | null
}>

export type TTraceGateRow = Readonly<{
  activity_run_id: string | null
  gate: string
  passed: number
  violations_json: string | null
  checks_json: string | null
}>

/** Everything one session wrote, as rows. Shaping is the use-case's job. */
export type TTraceRows = Readonly<{
  session: TTraceSessionRow
  activityRuns: readonly TTraceActivityRunRow[]
  events: readonly TTraceEventRow[]
  envelopes: readonly TTraceEnvelopeRow[]
  gates: readonly TTraceGateRow[]
}>

const BASE_SESSION_COLUMNS =
  'run_id, lifecycle, request, status, engineer, started_at, ended_at, ' +
  'total_tokens, total_cost'

/**
 * `name` is a column a tracer ADDS by migration. This reader opens readonly
 * and never migrates, so a database written before this column existed would
 * throw "no such column: name" on every select — selecting it only when it
 * is there, and substituting NULL otherwise, is the same guard the
 * visualizer's `optionalColumn` already applies for every other migrated
 * column.
 */
const hasNameColumn = (db: Database): boolean =>
  db
    .query<{ name: string }, []>('PRAGMA table_info(sessions)')
    .all()
    .some((row) => row.name === 'name')

const sessionColumns = (db: Database): string =>
  hasNameColumn(db)
    ? `${BASE_SESSION_COLUMNS}, name`
    : `${BASE_SESSION_COLUMNS}, NULL AS name`

const readSession = (
  db: Database,
  runId: string | undefined,
): TTraceSessionRow | undefined => {
  const columns = sessionColumns(db)
  return runId === undefined
    ? db
        .query<TTraceSessionRow, []>(
          `SELECT ${columns} FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT 1`,
        )
        .get() || undefined
    : db
        .query<TTraceSessionRow, [string]>(
          `SELECT ${columns} FROM sessions WHERE run_id=?`,
        )
        .get(runId) || undefined
}

/**
 * Every row one session wrote, or `undefined` when there is no such session.
 *
 * Opens and closes around the read: a reporter process holding a handle open
 * on a WAL db is a file lock nobody asked for.
 */
export const readTrace = (
  dbPath: string,
  runId?: string,
): TTraceRows | undefined => {
  if (!fileExists(dbPath)) {
    return undefined
  }
  const db = new Database(dbPath, { readonly: true })
  db.run('PRAGMA busy_timeout=5000;')
  const session = readSession(db, runId)
  if (session === undefined) {
    db.close()
    return undefined
  }
  const id = session.run_id
  const rows: TTraceRows = {
    session,
    activityRuns: db
      .query<TTraceActivityRunRow, [string]>(
        'SELECT activity_run_id, seq, name, kind, owner, description, status,' +
          ' error, started_at, ended_at FROM activity_runs WHERE run_id=? ORDER BY seq',
      )
      .all(id),
    events: db
      .query<TTraceEventRow, [string]>(
        'SELECT activity_run_id, type, name, payload_json, started_at FROM events' +
          ' WHERE run_id=? ORDER BY rowid',
      )
      .all(id),
    envelopes: db
      .query<TTraceEnvelopeRow, [string]>(
        'SELECT activity_run_id, agent, output_type, payload_json, valid,' +
          ' created_at FROM envelopes WHERE run_id=? ORDER BY rowid',
      )
      .all(id),
    gates: db
      .query<TTraceGateRow, [string]>(
        'SELECT activity_run_id, gate, passed, violations_json, checks_json' +
          ' FROM gate_results WHERE run_id=? ORDER BY id',
      )
      .all(id),
  }
  db.close()
  return rows
}
