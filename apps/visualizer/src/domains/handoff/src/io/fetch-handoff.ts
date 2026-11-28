import { scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { HandoffFile } from '../typedefs/handoff'

/**
 * The documents a run wrote, as the disk sees them.
 *
 * `undefined` means NOT KNOWN, and that is different from an empty listing
 * in the one way that matters: an empty listing says every reported document
 * is missing. A server too old to know this route answers 404, and the dev
 * server proxies to whichever API is running — so the first version of this
 * reported every document in the run as missing when the only thing wrong
 * was an API that predated the route.
 */
export const createFetchHandoff = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchHandoff(
    runId: string,
    workspace?: string,
  ): Promise<HandoffFile[] | undefined> {
    const res = await (request ?? fetch)(
      `/api/sessions/${encodeURIComponent(runId)}/handoff${scope(workspace)}`,
    )
    if (!res.ok) return undefined
    const rows = (await res.json()) as HandoffFile[]
    if (rows.length === 0) return rows
    const redactor = await store.forRun({ runId, workspace })
    return rows.map(redactFields<HandoffFile>(redactor, { text: ['title'] }))
  }

export const fetchHandoff = createFetchHandoff(redaction)
