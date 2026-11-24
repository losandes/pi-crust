import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import {
  safeParseSettlement,
  type TSettlement,
} from '../../../../../lib/typedefs'

export type TTraceListing = 'sessions' | 'activity-runs' | 'tail' | 'procs'

const STATEMENTS: Readonly<Record<TTraceListing, string>> = {
  sessions: `select
  cast(s.run_id as text),
  cast(s.status as text),
  cast(substr(s.request, 1, 50) as text),
  cast(s.total_tokens as text),
  cast(round(s.total_cost, 4) as text)
from sessions s
order by s.started_at desc
limit 10`,
  'activity-runs': `select
  cast(a.seq as text),
  cast(a.name as text),
  cast(a.kind as text),
  cast(a.owner as text),
  cast(a.status as text)
from activity_runs a
where a.run_id = ?
order by a.seq`,
  tail: `select
  cast(e.rowid as text),
  cast(e.type as text),
  cast(e.name as text),
  cast(e.started_at as text)
from events e
where e.run_id = ?
order by e.rowid desc
limit 25`,
  procs: `select
  cast(p.kind as text),
  cast(p.name as text),
  cast(p.pid as text),
  cast(p.command as text),
  cast(p.started_at as text)
from processes p
where p.run_id = ?
  and p.ended_at is null
order by p.id`,
}

const rowsSchema = z.array(
  z.array(
    z
      .string()
      .nullable()
      .transform((value) => value ?? ''),
  ),
)

export const resolveTraceListing =
  (dbPath: string) =>
  (
    listing: TTraceListing,
    runId: string | undefined,
  ): TSettlement<readonly string[]> => {
    if (!existsSync(dbPath))
      return {
        status: 'error',
        error: new Error(`no trace database at ${dbPath}`),
      }
    const result = safeParseSettlement(() => {
      const db = new Database(dbPath, { readonly: true })
      try {
        const statement = db.query(STATEMENTS[listing])
        const rows =
          listing === 'sessions'
            ? statement.values()
            : statement.values(runId ?? '')
        return rowsSchema.parse(rows).map((row) => row.join('|'))
      } finally {
        db.close()
      }
    })
    return result.status === 'ok'
      ? result
      : {
          status: 'error',
          error: new Error(`cannot read ${dbPath}: ${result.error.message}`),
        }
  }
