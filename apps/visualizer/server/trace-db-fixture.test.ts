/**
 * A temporary SQLite database carrying the real pi-crust schema (1.1.1).
 *
 * Named `*.test.ts` so bun's test runner skips it for coverage — it defines
 * no `test()` of its own, and `bun test`'s coverage reporter excludes test
 * files by default, which is exactly what a shared fixture is: a helper
 * `db.test.ts` and `writes.test.ts` both import, not a unit with its own
 * decision logic to cover.
 *
 * `SCHEMA` and `MIGRATIONS` come from `runtime/domains/trace/src/data/trace-db.ts`
 * (1.1.2) rather than being restated here, and both are applied (1.1.3) so a
 * fixture database has every column a tracer's own `migrate()` would add —
 * `sessions.archived`, in particular, which `setArchived` requires and which
 * `CREATE TABLE IF NOT EXISTS` alone would never add to a table already
 * created without it.
 */
import { Database } from 'bun:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MIGRATIONS,
  SCHEMA,
} from '../../../runtime/domains/trace/src/data/trace-db'

export interface TSessionRow {
  run_id: string
  lifecycle?: string | null
  request?: string | null
  status?: string | null
  engineer?: string | null
  started_at?: string | null
  ended_at?: string | null
  total_tokens?: number | null
  total_cost?: number | null
  archived?: number | null
  workspace_root?: string | null
  branch?: string | null
  name?: string | null
  [column: string]: unknown
}

export interface TActivityRunRow {
  activity_run_id: string
  run_id: string
  seq?: number | null
  name?: string | null
  kind?: string | null
  owner?: string | null
  description?: string | null
  status?: string | null
  error?: string | null
  started_at?: string | null
  ended_at?: string | null
  [column: string]: unknown
}

export interface TEventRow {
  event_id: string
  run_id: string
  activity_run_id?: string | null
  parent_id?: string | null
  type?: string | null
  name?: string | null
  payload_json?: string | null
  tokens?: number | null
  started_at?: string | null
  ended_at?: string | null
  [column: string]: unknown
}

/**
 * Create a fresh temporary directory (1.1.5) and a crust.db inside it
 * carrying the real schema plus migrations, and return its path.
 */
export const fixtureDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-fixture-'))
  const path = join(dir, 'crust.db')
  const db = new Database(path, { create: true })
  db.run(SCHEMA)
  for (const [table, column, declaration] of MIGRATIONS) {
    const columns = db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
    if (!columns.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    }
  }
  db.close()
  return path
}

const insert = (
  dbPath: string,
  table: string,
  row: Readonly<Record<string, unknown>>,
): void => {
  const columns = Object.keys(row)
  const db = new Database(dbPath)
  const values = columns.map(
    (column) => (row[column] ?? null) as string | number | null,
  )
  db.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values,
  )
  db.close()
}

/** Insert a sessions row (1.1.4), defaulting every optional column to null. */
export const insertSession = (dbPath: string, row: TSessionRow): void =>
  insert(dbPath, 'sessions', row)

/** Insert an activity_runs row (1.1.4). */
export const insertActivityRun = (dbPath: string, row: TActivityRunRow): void =>
  insert(dbPath, 'activity_runs', row)

/** Insert an events row (1.1.4). */
export const insertEvent = (dbPath: string, row: TEventRow): void =>
  insert(dbPath, 'events', row)
