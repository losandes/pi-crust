import { getJson, scope } from '@/lib/api-client'
import type { SessionDetail } from '../typedefs/session'

export async function fetchSession(
  runId: string,
  workspace?: string,
): Promise<SessionDetail> {
  const detail = (await getJson(
    `/api/sessions/${encodeURIComponent(runId)}${scope(workspace)}`,
  )) as SessionDetail
  return {
    session: detail.session,
    handoff_dir: detail.handoff_dir ?? '',
    usage: detail.usage ?? { read: 0, written: 0 },
    activityRuns: detail.activityRuns ?? [],
    agents: detail.agents ?? [],
  }
}
