import { createGetJson, scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { Envelope } from '../typedefs/activity-run'

export const createFetchEnvelopes = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchEnvelopes(
    runId: string,
    workspace?: string,
  ): Promise<Envelope[]> {
    const rows = (await createGetJson(request)(
      `/api/sessions/${encodeURIComponent(runId)}/envelopes${scope(workspace)}`,
    )) as Envelope[]
    if (rows.length === 0) return rows
    const redactor = await store.forRun({ runId, workspace })
    return rows.map(
      redactFields<Envelope>(redactor, { json: ['payload_json'] }),
    )
  }

export const fetchEnvelopes = createFetchEnvelopes(redaction)
