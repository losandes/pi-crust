import { authHeaders, explainWriteFailure } from './token'
import type {
  DecisionRequest,
  Envelope,
  EventRow,
  EventsPage,
  GateResult,
  HandoffFile,
  HealthResponse,
  PromptsResponse,
  SessionDetail,
  SessionSummary,
  WorkspaceInfo,
} from './types'

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res.json()
}

/**
 * The workspace a request is about, as a query string.
 *
 * Omitted when the caller does not know it, which is a complete address on
 * its own — the server finds the run across every tree it watches. Sent when
 * it is known, which makes the request exact rather than a search.
 */
const scope = (workspace: string | undefined, separator = '?'): string =>
  workspace === undefined || workspace === ''
    ? ''
    : `${separator}workspace=${encodeURIComponent(workspace)}`

export function fetchSessions(workspace?: string): Promise<SessionSummary[]> {
  return getJson(`/api/sessions${scope(workspace)}`) as Promise<SessionSummary[]>
}

export function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  return getJson('/api/workspaces') as Promise<WorkspaceInfo[]>
}

/**
 * The documents a run wrote, as the disk sees them.
 *
 * `undefined` means NOT KNOWN, and that is different from an empty listing
 * in the one way that matters: an empty listing says every reported document
 * is missing. A server too old to know this route answers 404, and the dev
 * server proxies to whichever API is running — so the first version of this
 * reported every document in the run as missing when the only thing wrong
 * was an API that predated the route.
 */
export async function fetchHandoff(
  runId: string,
  workspace?: string,
): Promise<HandoffFile[] | undefined> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(runId)}/handoff${scope(workspace)}`,
  )
  if (!res.ok) return undefined
  return (await res.json()) as HandoffFile[]
}

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
  `${path.replace(/^context_handoff\//, '').split('/').map(encodeURIComponent).join('/')}${scope(workspace)}`

export async function fetchSession(
  runId: string,
  workspace?: string,
): Promise<SessionDetail> {
  const detail = (await getJson(
    `/api/sessions/${encodeURIComponent(runId)}${scope(workspace)}`,
  )) as SessionDetail
  return {
    session: detail.session,
    usage: detail.usage ?? { read: 0, written: 0 },
    activityRuns: detail.activityRuns ?? [],
    agents: detail.agents ?? [],
  }
}

export async function fetchEvents(
  runId: string,
  after: number,
  limit = 500,
  workspace?: string,
): Promise<EventsPage> {
  const page = (await getJson(
    `/api/sessions/${encodeURIComponent(runId)}/events?after=${after}&limit=${limit}` +
      scope(workspace, '&'),
  )) as EventsPage | EventRow[]
  if (Array.isArray(page)) {
    const cursor = page.reduce((max, e) => Math.max(max, e.rowid), after)
    return { events: page, cursor, has_more: page.length === limit }
  }
  return { events: page.events ?? [], cursor: page.cursor ?? after, has_more: page.has_more ?? false }
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson('/api/health') as Promise<HealthResponse>
}

// ActivityRunDetail imports the prompts type from here alongside fetchPrompts.
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

/**
 * The question a waiting run is asking.
 *
 * A server too old to know this route answers 404, which reads as "no
 * question" rather than as a failure: the controls still work, and the person
 * is no worse off than before this endpoint existed.
 */
export async function fetchDecisionRequest(
  runId: string,
  workspace?: string,
): Promise<DecisionRequest> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(runId)}/decision-request${scope(workspace)}`,
  )
  if (res.status === 404) return { present: false }
  if (!res.ok) throw new Error(`GET decision-request → ${res.status}`)
  return (await res.json()) as DecisionRequest
}

export function fetchEnvelopes(
  runId: string,
  workspace?: string,
): Promise<Envelope[]> {
  return getJson(
    `/api/sessions/${encodeURIComponent(runId)}/envelopes${scope(workspace)}`,
  ) as Promise<Envelope[]>
}

export function fetchGates(
  runId: string,
  workspace?: string,
): Promise<GateResult[]> {
  return getJson(
    `/api/sessions/${encodeURIComponent(runId)}/gates${scope(workspace)}`,
  ) as Promise<GateResult[]>
}

/**
 * Writes. Every one carries the token, and every one reports WHY it failed.
 *
 * A settlement rather than a throw: these are driven by a button, and a
 * rejected promise in an onClick becomes an unhandled rejection in the console
 * where nobody reading the page will see it.
 */
export type TWriteResult =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; problem: string }>

const post = async (url: string, body: unknown): Promise<TWriteResult> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, problem: explainWriteFailure(response.status, text) }
    }
    return { ok: true, data: text === '' ? {} : JSON.parse(text) }
  } catch (cause) {
    return {
      ok: false,
      problem: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

/** Say something to an agent that is working right now. */
export const sendMessage = (
  runId: string,
  kind: 'steer' | 'follow_up' | 'abort',
  message: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(`/api/sessions/${encodeURIComponent(runId)}/messages${scope(workspace)}`, {
    kind,
    message,
    from: 'the web app',
  })

/**
 * Archive a run out of the review list, or restore it.
 *
 * A write like any other, and it was not: written before the token existed,
 * it sent no `x-crust-token` and threw a bare Error. The server refused it
 * with a 401 that reached nobody — the card re-appeared and said nothing,
 * which reads as a broken button rather than a locked one.
 */
export const archiveSession = (
  runId: string,
  archived = true,
  workspace?: string,
): Promise<TWriteResult> =>
  post(`/api/sessions/${encodeURIComponent(runId)}/archive${scope(workspace)}`, {
    archived,
  })

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

/** Answer a gate. The server records it and resumes the run. */
export const sendDecision = (
  runId: string,
  action: 'approve' | 'reject' | 'answer',
  text: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(`/api/sessions/${encodeURIComponent(runId)}/decision${scope(workspace)}`, {
    action,
    text,
    from: 'the web app',
  })

/**
 * Pick a finished run back up, exactly as it was launched.
 *
 * The server re-reads the invocation the run recorded, so every flag it
 * started with survives — resuming without `--approve-after plan` would
 * silently drop the gate the developer asked for.
 */
export const sendResume = (
  runId: string,
  workspace?: string,
): Promise<TWriteResult> =>
  post(`/api/sessions/${encodeURIComponent(runId)}/resume${scope(workspace)}`, {})
