/**
 * The gate over `gh-issue`'s claim: a coherent, checkable issue reference.
 *
 * Reads only the envelope — no network call, no filesystem read, no process
 * spawn — so it stays testable without `gh` credentials and never needs
 * `readsTree`. Live verification that the issue actually exists on GitHub is
 * the developer's job (`gh issue view <n>`); this gate can only prove the
 * agent reported a coherent reference, not a true one.
 */

import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'

const ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)$/

type TClaim = Readonly<{
  issue_url?: unknown
  issue_number?: unknown
  repo?: unknown
}>

export const issueCreated: TGate = {
  name: 'issue_created',
  check: (envelope: TEnvelopeBase) => {
    const claim = envelope as TClaim
    const url = typeof claim.issue_url === 'string' ? claim.issue_url : ''
    const match = url.match(ISSUE_URL_PATTERN)

    const withUrl = addCheck(
      emptyReport,
      'issue_url',
      match !== null,
      match === null
        ? 'no GitHub issue URL was reported — an issue nobody can open is one nobody created'
        : `matches ${url}`,
    )

    if (match === null) {
      const noUrl = 'there was no URL to check this against'
      const withNumber = addCheck(withUrl, 'issue_number', false, noUrl)
      return addCheck(withNumber, 'repo', false, noUrl)
    }

    const [, owner, name, trailingNumber] = match
    const repoFromUrl = `${owner}/${name}`
    const numberFromUrl = Number(trailingNumber)

    const withNumber = addCheck(
      withUrl,
      'issue_number',
      claim.issue_number === numberFromUrl,
      claim.issue_number === numberFromUrl
        ? `${numberFromUrl} matches the URL`
        : `issue_number ${JSON.stringify(claim.issue_number)} does not match the URL`,
    )

    return addCheck(
      withNumber,
      'repo',
      claim.repo === repoFromUrl,
      claim.repo === repoFromUrl
        ? `${repoFromUrl} matches the URL`
        : `repo '${String(claim.repo)}' does not match the URL`,
    )
  },
}
