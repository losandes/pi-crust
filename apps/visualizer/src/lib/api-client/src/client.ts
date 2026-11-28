import { redaction, type TRedactionStore } from '@/lib/redaction'
import { authHeaders, explainWriteFailure } from './token-store'

export const createGetJson =
  (request?: (...args: Parameters<typeof fetch>) => Promise<Response>) =>
  async (url: string): Promise<unknown> => {
    const res = await (request ?? fetch)(url)
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
    return res.json()
  }

export const getJson = createGetJson()

/**
 * The workspace a request is about, as a query string.
 *
 * Omitted when the caller does not know it, which is a complete address on
 * its own — the server finds the run across every tree it watches. Sent when
 * it is known, which makes the request exact rather than a search.
 */
export const scope = (
  workspace: string | undefined,
  separator = '?',
): string =>
  workspace === undefined || workspace === ''
    ? ''
    : `${separator}workspace=${encodeURIComponent(workspace)}`

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

export const createPost =
  (
    store: TRedactionStore,
    request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
  ) =>
  async (url: string, body: unknown): Promise<TWriteResult> => {
    // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, converting a network failure or a malformed response into the settlement every caller already reads
    try {
      const response = await (request ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      if (!response.ok) {
        const safeText = await store.base().then(
          (redactor) => redactor.text(text),
          () => '',
        )
        return {
          ok: false,
          problem: explainWriteFailure(response.status, safeText),
        }
      }
      return { ok: true, data: text === '' ? {} : JSON.parse(text) }
    } catch (cause) {
      return {
        ok: false,
        problem: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }

export const post = createPost(redaction)
