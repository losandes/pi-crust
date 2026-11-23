/** Output checks derived from the envelope an Activity reports. */

import type {
  TEnvelopeBase,
  TEnvelopeSpec,
  TGate,
} from '../../../../lib/contracts'
import { buildOutput, reviewOutput } from '../../../../lib/contracts'
import {
  artifactsExist,
  diffMatchesClaims,
  filesNonEmpty,
  jsonParses,
  reproductionSupported,
} from './claim-gates'
import { issueCreated } from './issue-gates'
import { verdictConsistent } from './verdict-gates'

/** Checks over declared artifacts. They run after every Activity. */
export const ARTIFACT_CHECKS: readonly TGate[] = [
  artifactsExist,
  filesNonEmpty,
  jsonParses,
]

const SPEC_CHECKS: Readonly<Record<string, TGate>> = {
  [reviewOutput.name]: verdictConsistent,
  GhIssueOutput: issueCreated,
  DiagnosisOutput: reproductionSupported,
  [buildOutput.name]: diffMatchesClaims,
}

/** Artifact checks, then the one check this spec implies. Never commands. */
export const outputChecks = (
  spec: TEnvelopeSpec<TEnvelopeBase>,
): readonly TGate[] => {
  const own = SPEC_CHECKS[spec.name]
  return own === undefined ? ARTIFACT_CHECKS : [...ARTIFACT_CHECKS, own]
}

export const activityChecks = (
  activity: Readonly<{ name: string; spec: TEnvelopeSpec<TEnvelopeBase> }>,
): readonly TGate[] => outputChecks(activity.spec)
