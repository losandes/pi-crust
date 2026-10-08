/**
 * The write token, as the browser holds it.
 *
 * The server demands `CRUST_TOKEN` on every write and the page cannot know it
 * — it is a secret held by whoever started the server. So it is pasted once
 * and kept in localStorage: wrong for a multi-user service, right for a
 * dashboard one engineer runs against their own machine.
 *
 * It is never put in a URL. A token in a query string lands in history, in
 * referrers, and in any log the request passes through, and a screenshot of
 * the address bar becomes a credential leak.
 */

export const TOKEN_KEY = 'crust.token'
export const TOKEN_HEADER = 'x-crust-token'

export const readToken = (): string => {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export const writeToken = (token: string): void => {
  try {
    window.localStorage.setItem(TOKEN_KEY, token.trim())
  } catch {
    // A private window still gets a working session; it just asks again next
    // time, which is better than refusing to work at all.
  }
}

/** The header every write carries, or nothing when no token has been given. */
export const authHeaders = (): Readonly<Record<string, string>> => {
  const token = readToken()
  return token === '' ? {} : { [TOKEN_HEADER]: token }
}

/**
 * What a failed write means, in words a reader can act on.
 *
 * 503 and 401 are different problems with different fixes, and "request
 * failed" tells someone neither of them.
 */
export const explainWriteFailure = (status: number, body: string): string => {
  if (status === 503) {
    return (
      'Writes are disabled on the server. Start it with CRUST_TOKEN set, ' +
      'then paste the same value here.'
    )
  }
  if (status === 401) {
    return 'That token was not accepted. Paste the server\'s CRUST_TOKEN.'
  }
  return body === '' ? `Request failed (${status}).` : body
}
