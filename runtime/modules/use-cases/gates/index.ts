/** Every reusable gate, in one import for the workflow scripts. */

import type { TGate } from '../../typedefs/gate'
import {
  artifactsExist,
  diffMatchesClaims,
  filesNonEmpty,
  jsonParses,
  reproductionSupported,
} from './claim-gates'
import { checks } from './checks-gate'
import { disputesSupported } from './dispute-gates'
import { issueCreated } from './issue-gates'
import { stepsValid } from './plan-gates'
import { verdictConsistent } from './verdict-gates'

export {
  artifactsExist,
  diffMatchesClaims,
  filesNonEmpty,
  jsonParses,
  reproductionSupported,
} from './claim-gates'
export { checks, checkedPaths, checksReport } from './checks-gate'
export { disputesSupported } from './dispute-gates'
export { issueCreated } from './issue-gates'
export { plannedNames, stepsValid } from './plan-gates'
export { verdictConsistent } from './verdict-gates'

/**
 * Every gate an Activity may name, by the name it is named by.
 *
 * Published for the same reason the envelope specs are: an Activity's
 * `gates:` list is configuration, and a name nothing publishes has to be
 * refused at load with this list as the answer. Keys are the names a
 * developer writes in `crust.activities.yaml`.
 */
export const GATE_CATALOGUE: Readonly<Record<string, TGate>> = {
  artifactsExist,
  checks,
  diffMatchesClaims,
  disputesSupported,
  filesNonEmpty,
  issueCreated,
  jsonParses,
  reproductionSupported,
  stepsValid,
  verdictConsistent,
}

export const GATE_NAMES: readonly string[] = Object.keys(GATE_CATALOGUE)

/** The gate an Activity named, or undefined when nothing publishes it. */
export const gateNamed = (name: string): TGate | undefined =>
  GATE_CATALOGUE[name]
