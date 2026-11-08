import { post, scope, type TWriteResult } from '@/lib/api-client'

/** Say something to an agent that is working right now. */
export const sendMessage = (
  runId: string,
  kind: 'steer' | 'follow_up' | 'abort',
  message: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(
    `/api/sessions/${encodeURIComponent(runId)}/messages${scope(workspace)}`,
    {
      kind,
      message,
      from: 'the web app',
    },
  )
