/** Engine-owned gates over terminal delivery results, never forge calls. */

import type { TGateReport } from '../../../../lib/contracts'
import { addCheck, emptyReport } from '../../../../lib/contracts'

export type TDelivered = Readonly<{
  /** What the terminal Activity reported; never a recoverable refusal. */
  result: Readonly<{ action: string; url: string; reason: string }>
}>

export type TDeliveryGate = Readonly<{
  name: string
  check: (delivered: TDelivered) => TGateReport
}>

const pullRequestOpened: TDeliveryGate = {
  name: 'pull_request_opened',
  check: ({ result }) => {
    const opened =
      (result.action === 'created' || result.action === 'updated') &&
      result.url.trim() !== ''
    const note = opened
      ? `${result.action} ${result.url}`
      : result.action === 'refused'
        ? `none opened — ${result.reason}`
        : `${result.action} reported no URL`

    return addCheck(emptyReport, 'pull request', opened, note)
  },
}

/** An array so a later delivery gate is added rather than wired in. */
export const DELIVERY_GATES: readonly TDeliveryGate[] = [pullRequestOpened]
