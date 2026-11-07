import { scope } from '@/lib/api-client'

/** One document's text, for reading without leaving the page. */
export async function fetchHandoffFile(
  runId: string,
  path: string,
  workspace?: string,
): Promise<string> {
  const within = path.replace(/^context_handoff\//, '')
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(runId)}/handoff/` +
      `${within.split('/').map(encodeURIComponent).join('/')}${scope(workspace)}`,
  )
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.text()
}

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
