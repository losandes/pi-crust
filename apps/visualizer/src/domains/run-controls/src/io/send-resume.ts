import { post, scope, type TWriteResult } from '@/lib/api-client'

/**
 * Pick a finished run back up, exactly as it was launched.
 *
 * The server re-reads the invocation the run recorded, so every flag it
 * started with survives — resuming without `--approve-after plan` would
 * silently drop the gate the developer asked for.
 */
export const sendResume = (
  runId: string,
  workspace?: string,
  note?: string,
): Promise<TWriteResult> =>
  post(`/api/sessions/${encodeURIComponent(runId)}/resume${scope(workspace)}`, {
    note: note ?? '',
  })
