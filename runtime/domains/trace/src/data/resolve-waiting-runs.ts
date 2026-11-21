import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'

export type TWaitingRun = Readonly<{
  run_id: string
  lifecycle: string
  status: string
  started_at: string
  name: string
}>

/**
 * `name` is a column a tracer ADDS by migration. This query opens the db
 * readonly and never migrates it, so selecting the column unconditionally
 * would throw "no such column: name" against a database an older pi-crust
 * wrote. Probing first and substituting NULL is the same guard the
 * visualizer's `optionalColumn` applies.
 */
const hasNameColumn = (db: Database): boolean =>
  db
    .query<{ name: string }, []>('PRAGMA table_info(sessions)')
    .all()
    .some((row) => row.name === 'name')

/**
 * Runs that are waiting on a person, newest first.
 *
 * Only waiting ones. A menu of every run this repository has ever done is a
 * list to search, not a question to answer — and the only run id worth
 * offering is one where naming it would actually do something.
 */
export const resolveWaitingRuns = (dbPath: string): readonly TWaitingRun[] => {
  if (!existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true })
  try {
    const nameColumn = hasNameColumn(db) ? 'name' : 'NULL AS name'
    return db
      .query(
        `SELECT run_id, lifecycle, status, started_at, ${nameColumn} FROM sessions ` +
          "WHERE status='waiting' ORDER BY started_at DESC LIMIT 20",
      )
      .all()
      .map((row) => {
        const value = row as Omit<TWaitingRun, 'name'> & { name: string | null }
        return { ...value, name: value.name ?? '' }
      })
  } finally {
    db.close()
  }
}
