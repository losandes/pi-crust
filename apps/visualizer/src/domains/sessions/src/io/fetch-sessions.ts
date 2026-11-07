import { getJson, scope } from '@/lib/api-client'
import type { SessionSummary } from '../typedefs/session'

export function fetchSessions(
  workspace?: string,
  includeArchived = false,
): Promise<SessionSummary[]> {
  const base = scope(workspace)
  const archived = includeArchived
    ? `${base === '' ? '?' : '&'}include_archived=1`
    : ''
  return getJson(`/api/sessions${base}${archived}`) as Promise<SessionSummary[]>
}
