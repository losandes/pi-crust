import { getJson, scope } from '@/lib/api-client'
import type { GateResult } from '../typedefs/activity-run'

export function fetchGates(
  runId: string,
  workspace?: string,
): Promise<GateResult[]> {
  return getJson(
    `/api/sessions/${encodeURIComponent(runId)}/gates${scope(workspace)}`,
  ) as Promise<GateResult[]>
}
