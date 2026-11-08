import { post, scope, type TWriteResult } from '@/lib/api-client'

/**
 * Ask a finished Activity Run a question, or have it amend its own document.
 *
 * Returns as soon as the consult STARTS. Rejoining a hundred-thousand-token
 * conversation takes a minute, and the answer arrives the way everything
 * else does — as an event the trace poll picks up.
 */
export const sendConsult = (
  runId: string,
  activity: string,
  mode: 'ask' | 'amend',
  question: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(
    `/api/sessions/${encodeURIComponent(runId)}/activities/${encodeURIComponent(activity)}` +
      `/consult${scope(workspace)}`,
    { mode, question },
  )
