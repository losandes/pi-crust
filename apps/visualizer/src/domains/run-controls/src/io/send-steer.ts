import { post, scope, type TWriteResult } from '@/lib/api-client'

/**
 * Send a run back to an Activity Run, replaying it and everything after it.
 *
 * `target` is required by the caller, never defaulted here: overwrite
 * discards the path being steered away from and branch keeps both.
 */
export const sendSteer = (
  runId: string,
  activity: string,
  target: 'overwrite' | 'branch',
  note: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(
    `/api/sessions/${encodeURIComponent(runId)}/activities/${encodeURIComponent(activity)}` +
      `/steer${scope(workspace)}`,
    { target, note },
  )
