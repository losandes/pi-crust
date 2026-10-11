/**
 * The step registry: a name resolves to a step, and nothing else does.
 *
 * `compose.ts` takes an ordered subset of these names at the call site, so an
 * unknown one must fail loudly and list what was available — a silently
 * dropped step would make a chain quietly shorter than the developer asked for.
 */

import type { TStep, TStepName, TStepOptions } from '../../typedefs/step'
import {
  DEFAULT_STEP_OPTIONS,
  isStepName,
  STEP_NAMES,
} from '../../typedefs/step'
import {
  buildStep,
  codeReviewStep,
  dataResearchStep,
  domainResearchStep,
  triageStep,
  operatorStep,
  securityResearchStep,
  technicalResearchStep,
  uxDesignStep,
  uxResearchStep,
  conceptualizeStep,
  designStep,
  diagnoseStep,
  identifyStep,
  pocStep,
  planStep,
  promptStep,
  reviewStep,
  reviseStep,
  scoutStep,
  testStep,
} from './agent-steps'
import { commitStep } from './commit-step'
import { documentStep } from './document-step'
import { verifyStep } from './verify-step'

export type TStepFactory = (options: TStepOptions) => TStep

export const STEP_REGISTRY: Readonly<Record<TStepName, TStepFactory>> = {
  prompt: promptStep,
  scout: scoutStep,
  'technical-research': technicalResearchStep,
  'ux-research': uxResearchStep,
  'domain-research': domainResearchStep,
  'security-research': securityResearchStep,
  'data-research': dataResearchStep,
  'ux-design': uxDesignStep,
  operator: operatorStep,
  triage: triageStep,
  identify: identifyStep,
  diagnose: diagnoseStep,
  conceptualize: conceptualizeStep,
  plan: planStep,
  design: designStep,
  poc: pocStep,
  test: testStep,
  build: buildStep,
  verify: verifyStep,
  review: reviewStep,
  'code-review': codeReviewStep,
  revise: reviseStep,
  commit: commitStep,
  document: documentStep,
}

/** Agents every chosen step needs, deduplicated — checked before any spawn. */
/**
 * The agent a step is performed by, as the registry binds it.
 *
 * Empty for the deterministic steps — `verify` and `commit` have no
 * performer. The menu asks this to decide what a step is for and whether it
 * is hidden; the concurrency check asks it to find out what a step may write.
 * One answer, because two would eventually disagree.
 */
export const performerOf = (step: string): string | undefined =>
  STEP_REGISTRY[step as keyof typeof STEP_REGISTRY]?.(DEFAULT_STEP_OPTIONS)
    .requires[0]

export const requiredAgents = (steps: readonly TStep[]): readonly string[] => [
  ...new Set(steps.flatMap((step) => step.requires)),
]

/**
 * Resolve names to steps, numbering repeats so their phase names stay unique.
 *
 * A repeated step is legitimate — `build, verify, build, verify` is a fix loop
 * written out longhand — and the second occurrence becomes `build_2`, the same
 * convention the hand-written workflows already use for `test_1`/`fix_1`.
 */
export const resolveSteps = (
  names: readonly string[],
  options: Readonly<Partial<TStepOptions>> = {},
): readonly TStep[] => {
  const unknown = names.filter((name) => !isStepName(name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown step(s): ${unknown.join(', ')} — valid steps are ` +
        `${STEP_NAMES.join(', ')}`,
    )
  }
  return (names as readonly TStepName[]).map((name, index) =>
    STEP_REGISTRY[name]({
      ...DEFAULT_STEP_OPTIONS,
      ...options,
      instance:
        names.slice(0, index).filter((seen) => seen === name).length + 1,
    }),
  )
}
