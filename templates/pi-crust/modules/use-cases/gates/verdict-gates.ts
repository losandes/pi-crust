/** Gates that check a review envelope against itself. */

import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'

type TReviewShape = Readonly<{
  approved?: unknown
  blocking?: unknown
  findings?: unknown
}>

const unmetRequirements = (envelope: TEnvelopeBase): readonly string[] => {
  const findings = (envelope as TReviewShape).findings
  return Array.isArray(findings)
    ? findings
        .filter(
          (finding) =>
            finding !== null &&
            typeof finding === 'object' &&
            (finding as { met?: unknown }).met !== true,
        )
        .map((finding) =>
          String((finding as { requirement?: unknown }).requirement),
        )
    : []
}

/**
 * A review's verdict must agree with the findings it just wrote down.
 *
 * Nothing here judges the code — that is the reviewer's job. This checks the
 * envelope against itself: an approval that ships blocking items, or a
 * rejection that names no problem, is a claim the harness can refute without
 * reading a line of the diff.
 */
export const verdictConsistent: TGate = {
  name: 'verdict_consistent',
  check: (envelope) => {
    const shape = envelope as TReviewShape
    const approved = shape.approved === true
    const blocking = Array.isArray(shape.blocking) ? shape.blocking : []
    const unmet = unmetRequirements(envelope)

    const blockingNote =
      blocking.length === 0
        ? 'no blocking items'
        : approved
          ? `${blocking.length} blocking item(s) while approved=true`
          : `${blocking.length} blocking item(s), not approved`
    const findingsNote =
      unmet.length === 0
        ? 'every requirement met'
        : approved
          ? `${unmet.length} unmet requirement(s) while approved=true`
          : `${unmet.length} unmet requirement(s), not approved`
    const supported = approved || blocking.length > 0 || unmet.length > 0

    return [
      [
        'approved vs blocking',
        !(approved && blocking.length > 0),
        blockingNote,
      ],
      ['approved vs findings', !(approved && unmet.length > 0), findingsNote],
      [
        'rejection names a problem',
        supported,
        supported
          ? 'verdict is supported'
          : 'approved=false but no blocking item or unmet requirement was given',
      ],
    ].reduce(
      (report, [item, ok, note]) =>
        addCheck(report, String(item), ok === true, String(note)),
      emptyReport,
    )
  },
}
