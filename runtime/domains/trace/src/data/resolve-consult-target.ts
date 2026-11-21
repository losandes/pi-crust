import { Database } from 'bun:sqlite'
import type { TSettlement } from '../../../../../lib/typedefs'
import { safeParseSettlement } from '../../../../../lib/typedefs'

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

export type TConsultTarget = Readonly<{
  activityRunId: string
  agent: string
  sessionId: string
  model: string
  own: readonly string[]
}>
export const resolveConsultTarget =
  (dbPath: string) =>
  (runId: string, activity: string): TSettlement<TConsultTarget> => {
    const db = new Database(dbPath, { readonly: true })
    try {
      const activityRun = activityRunOf(db, runId, activity)
      if (activityRun === undefined)
        return {
          status: 'error',
          error: new Error(`no activity "${activity}" in run ${runId}`),
        }
      const session = sessionOf(db, runId, activityRun.owner)
      if (session === undefined)
        return {
          status: 'error',
          error: new Error(
            `no recorded session for ${activityRun.owner} in run ${runId}`,
          ),
        }
      return {
        status: 'ok',
        data: {
          activityRunId: activityRun.activity_run_id,
          agent: activityRun.owner,
          sessionId: session.session_id,
          model: session.model,
          own: ownedBy(db, activityRun.activity_run_id),
        },
      }
    } finally {
      db.close()
    }
  }
