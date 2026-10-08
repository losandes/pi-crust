/**
 * The escalation a developer reads when neither agent would move.
 *
 * Separate from the loop because it is presentation: the loop decides that a
 * disagreement is over, and this decides how to show it. Separate from the
 * ledger because the ledger is the record and this is a rendering of it.
 */

import type { TRoundRecord } from './dispute-ledger'

export const REPORT_FILENAME = 'disputes.md'

/** The escalation a developer reads: what each side said, and in which round. */
export const renderReport = (
  rounds: readonly TRoundRecord[],
  unmoved: readonly string[],
): string => {
  const open = unmoved.length > 0 ? unmoved : (rounds.at(-1)?.blocking ?? [])
  const sections = open.map((finding) => {
    const lines = rounds.flatMap((round) =>
      round.blocking.includes(finding)
        ? [
            `- round ${round.round} — reviewer: ${round.evidence[finding] || '(no evidence given)'}`,
            `- round ${round.round} — builder: ${round.disputes[finding] || '(not disputed)'}`,
          ]
        : [],
    )
    return `## ${finding}\n\n${lines.join('\n')}\n`
  })
  return (
    '# Unresolved findings\n\n' +
    'The harness stopped the revise loop and handed these to you. Neither ' +
    'agent settled them.\n\n' +
    `${sections.join('\n') || '(none)\n'}`
  )
}
