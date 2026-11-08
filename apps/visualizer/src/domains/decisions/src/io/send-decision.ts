import { post, scope, type TWriteResult } from '@/lib/api-client'

/** Answer a gate. The server records it and resumes the run. */
export const sendDecision = (
  runId: string,
  action: 'approve' | 'reject' | 'answer',
  text: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(
    `/api/sessions/${encodeURIComponent(runId)}/decision${scope(workspace)}`,
    {
      action,
      text,
      from: 'the web app',
    },
  )
