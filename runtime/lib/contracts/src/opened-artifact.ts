import type { TEnvelopeBase, TEnvelopeSpec } from './envelope'
import { ghIssueOutput } from './envelope'
import type { TEventPayload } from './trace'

export const ISSUE_OPENED_EVENT = 'issue_opened'
export const PULL_REQUEST_EVENT = 'pull_request'

export const GITHUB_ISSUE_URL =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)$/

export type TOpenedArtifact = Readonly<{
  kind: 'issue' | 'pull request'
  url: string
}>

export const issueOpenedBy = (
  spec: Readonly<Pick<TEnvelopeSpec<TEnvelopeBase>, 'name'>>,
  envelope: TEnvelopeBase,
): string | undefined => {
  const claim = envelope as Readonly<{ issue_url?: unknown }>
  return spec.name === ghIssueOutput.name &&
    typeof claim.issue_url === 'string' &&
    GITHUB_ISSUE_URL.test(claim.issue_url)
    ? claim.issue_url
    : undefined
}

export const openedArtifacts = (
  recorded: Readonly<{
    issues: readonly TEventPayload[]
    pullRequests: readonly TEventPayload[]
  }>,
): readonly TOpenedArtifact[] => {
  const opened = (
    [
      ['issue', recorded.issues],
      ['pull request', recorded.pullRequests],
    ] as const
  ).flatMap(([kind, payloads]) =>
    payloads.flatMap(({ url }) =>
      typeof url === 'string' && url.startsWith('https://') && !/\s/.test(url)
        ? [{ kind, url }]
        : [],
    ),
  )
  return opened.filter(
    (artifact, index) =>
      opened.findIndex(({ url }) => url === artifact.url) === index,
  )
}

export const renderOpened = (
  opened: readonly TOpenedArtifact[],
): readonly string[] =>
  opened.map(({ kind, url }) => `  ${kind.padEnd(12)}   ${url}`)
