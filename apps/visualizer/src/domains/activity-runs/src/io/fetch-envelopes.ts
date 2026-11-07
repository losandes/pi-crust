import { getJson, scope } from '@/lib/api-client'
import type { Envelope } from '../typedefs/activity-run'

export function fetchEnvelopes(
  runId: string,
  workspace?: string,
): Promise<Envelope[]> {
  return getJson(
    `/api/sessions/${encodeURIComponent(runId)}/envelopes${scope(workspace)}`,
  ) as Promise<Envelope[]>
}
