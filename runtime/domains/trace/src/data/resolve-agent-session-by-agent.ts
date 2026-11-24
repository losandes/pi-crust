import { z } from 'zod'
import { openDatabase } from '../../../../../lib/sqlite'
import { fileExists } from '../../../../lib/system'

export type TAgentSessionRef = Readonly<{ sessionId: string }>

const agentSessionSchema = z.object({ session_id: z.string().min(1) })

export const resolveAgentSessionByAgent =
  (dbPath: string) =>
  (runId: string, agent: string): TAgentSessionRef | undefined => {
    if (!fileExists(dbPath)) return undefined
    const db = openDatabase(dbPath, { readonly: true })
    db.run('PRAGMA busy_timeout=5000;')
    const row = db
      .query<unknown, [string, string]>(
        `SELECT
          s.session_id
        FROM agent_sessions AS s
        WHERE s.run_id = ?
          AND s.agent = ?`,
      )
      .get(runId, agent)
    db.close()
    const parsed = agentSessionSchema.safeParse(row)
    return parsed.success ? { sessionId: parsed.data.session_id } : undefined
  }
