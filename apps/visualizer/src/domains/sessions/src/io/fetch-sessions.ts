import { createGetJson, scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { SessionSummary } from '../typedefs/session'

export const createFetchSessions = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchSessions(
    workspace?: string,
    includeArchived = false,
  ): Promise<SessionSummary[]> {
    const base = scope(workspace)
    const archived = includeArchived
      ? `${base === '' ? '?' : '&'}include_archived=1`
      : ''
    const rows = (await createGetJson(request)(
      `/api/sessions${base}${archived}`,
    )) as SessionSummary[]
    if (rows.length === 0) return rows
    const baseRedactor = await store.base()
    return rows.map((row) => {
      const roots = {
        repository_root: row.repository_root,
        workspace_root: row.workspace_root,
      }
      store.remember({ runId: row.run_id, workspace: row.workspace }, roots)
      const redactor = baseRedactor.forRun(roots)
      return {
        ...redactFields<SessionSummary>(redactor, {
          text: ['request', 'name'],
        })(row),
        ...(row.repository_root
          ? { repository_location: redactor.location(row.repository_root) }
          : {}),
        ...(row.workspace_root
          ? { workspace_location: redactor.location(row.workspace_root) }
          : {}),
        activityRuns: row.activityRuns.map(
          redactFields<SessionSummary['activityRuns'][number]>(redactor, {
            text: ['error', 'description'],
          }),
        ),
      }
    })
  }

export const fetchSessions = createFetchSessions(redaction)
