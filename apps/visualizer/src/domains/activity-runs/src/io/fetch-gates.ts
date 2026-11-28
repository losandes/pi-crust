import { createGetJson, scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { GateResult } from '../typedefs/activity-run'

export const createFetchGates = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchGates(
    runId: string,
    workspace?: string,
  ): Promise<GateResult[]> {
    const rows = (await createGetJson(request)(
      `/api/sessions/${encodeURIComponent(runId)}/gates${scope(workspace)}`,
    )) as GateResult[]
    if (rows.length === 0) return rows
    const redactor = await store.forRun({ runId, workspace })
    return rows.map(
      redactFields<GateResult>(redactor, {
        json: ['violations_json', 'checks_json'],
      }),
    )
  }

export const fetchGates = createFetchGates(redaction)
