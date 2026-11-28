import { scope } from '@/lib/api-client'
import { redaction, type TRedactionStore } from '@/lib/redaction'
import type { DecisionRequest } from '../typedefs/decision'

/**
 * The question a waiting run is asking.
 *
 * A server too old to know this route answers 404, which reads as "no
 * question" rather than as a failure: the controls still work, and the person
 * is no worse off than before this endpoint existed.
 */
export const createFetchDecisionRequest = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchDecisionRequest(
    runId: string,
    workspace?: string,
  ): Promise<DecisionRequest> {
    const res = await (request ?? fetch)(
      `/api/sessions/${encodeURIComponent(runId)}/decision-request${scope(workspace)}`,
    )
    if (res.status === 404) return { present: false }
    if (!res.ok) throw new Error(`GET decision-request → ${res.status}`)
    const data = (await res.json()) as DecisionRequest
    if (!data.present) return data
    const redactor = await store.forRun({ runId, workspace })
    return { ...data, markdown: redactor.text(data.markdown) }
  }

export const fetchDecisionRequest = createFetchDecisionRequest(redaction)
