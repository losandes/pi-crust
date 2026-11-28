import { scope } from '@/lib/api-client'
import { redaction, type TRedactionStore } from '@/lib/redaction'

/** One document's text, for reading without leaving the page. */
export const createFetchHandoffFile = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchHandoffFile(
    runId: string,
    path: string,
    workspace?: string,
  ): Promise<string> {
    const within = path.replace(/^context_handoff\//, '')
    const res = await (request ?? fetch)(
      `/api/sessions/${encodeURIComponent(runId)}/handoff/` +
        `${within.split('/').map(encodeURIComponent).join('/')}${scope(workspace)}`,
    )
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    const body = await res.text()
    if (body === '') return body
    return (await store.forRun({ runId, workspace })).text(body)
  }

export const fetchHandoffFile = createFetchHandoffFile(redaction)

/** The same document, as a link a browser can open in its own tab. */
export const handoffHref = (
  runId: string,
  path: string,
  workspace?: string,
): string =>
  `/api/sessions/${encodeURIComponent(runId)}/handoff/` +
  `${path
    .replace(/^context_handoff\//, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}${scope(workspace)}`
