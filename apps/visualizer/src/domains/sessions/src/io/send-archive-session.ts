import { post, scope, type TWriteResult } from '@/lib/api-client'

/**
 * Archive a run out of the review list, or restore it.
 *
 * A write like any other, and it was not: written before the token existed,
 * it sent no `x-crust-token` and threw a bare Error. The server refused it
 * with a 401 that reached nobody — the card re-appeared and said nothing,
 * which reads as a broken button rather than a locked one.
 */
export const archiveSession = (
  runId: string,
  archived = true,
  workspace?: string,
): Promise<TWriteResult> =>
  post(
    `/api/sessions/${encodeURIComponent(runId)}/archive${scope(workspace)}`,
    {
      archived,
    },
  )
