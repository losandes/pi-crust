import { scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { PromptsResponse } from '../typedefs/activity-run'

export type { PromptsResponse }

export const createFetchPrompts = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchPrompts(
    runId: string,
    agent: string,
    workspace?: string,
  ): Promise<PromptsResponse> {
    const res = await (request ?? fetch)(
      `/api/sessions/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agent)}/prompts` +
        scope(workspace),
    )
    // Not recorded (or endpoint not deployed yet) renders as "no prompts", not an error.
    if (res.status === 404) return { system: null, user: null }
    if (!res.ok) throw new Error(`GET prompts → ${res.status}`)
    const data = (await res.json()) as Partial<PromptsResponse>
    const prompts = { system: data.system ?? null, user: data.user ?? null }
    if (!(prompts.system || prompts.user)) return prompts
    const redactor = await store.forRun({ runId, workspace })
    return redactFields<PromptsResponse>(redactor, {
      text: ['system', 'user'],
    })(prompts)
  }

export const fetchPrompts = createFetchPrompts(redaction)
