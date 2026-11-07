import { scope } from '@/lib/api-client'
import type { PromptsResponse } from '../typedefs/activity-run'

export type { PromptsResponse }

export async function fetchPrompts(
  runId: string,
  agent: string,
  workspace?: string,
): Promise<PromptsResponse> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agent)}/prompts` +
      scope(workspace),
  )
  // Not recorded (or endpoint not deployed yet) renders as "no prompts", not an error.
  if (res.status === 404) return { system: null, user: null }
  if (!res.ok) throw new Error(`GET prompts → ${res.status}`)
  const data = (await res.json()) as Partial<PromptsResponse>
  return { system: data.system ?? null, user: data.user ?? null }
}
