/**
 * The operator's plan, turned into the rest of its own run.
 *
 * Every other step produces something a person reads. This one produces the
 * chain, and the chain executes — so the run it is part of cannot be a fixed
 * list decided before anything spawned.
 *
 * Two things fall out of that, and both are the reason this module is small
 * rather than clever:
 *
 * The plan is read back from the TRACE, never from a variable. A resumed run
 * must execute the chain the operator chose the first time, not a chain it
 * would choose today — the activity runs already in the trace belong to the first
 * one, and resume skips completed activityRuns BY NAME. Two chains in one trace is
 * corruption wearing the appearance of flexibility.
 *
 * Nothing here decides whether the chain may run. That is the trust dial's
 * job, and it already works: the operator reports its chosen chain as a
 * consequential question with the chain as its `provisional_answer`, so below
 * trust 50 the run stops and waits for a person exactly like any other
 * consequential decision, and at 50 or above it proceeds and is reported in
 * the end-of-run list of what the run decided for itself. Adding a second
 * mechanism here would mean two controls for one intention.
 */

import { plannedNames } from './gates'
import { narrowEnvelope, operatorPlanOutput } from '../typedefs/envelope'
import type { TStepContext } from '../typedefs/step'

/**
 * The chain an operator activityRun chose, or nothing when this run had no operator.
 *
 * Filtered to real step names a second time, after the gate already checked
 * them. Not redundancy for its own sake: the gate runs against the agent's
 * reply, and this runs against whatever is in the trace — including a trace
 * written by an older version of this factory, where a step that existed then
 * may not exist now. A resumed run must not die on a name it cannot resolve.
 */
export const plannedChain = (ctx: TStepContext): readonly string[] => {
  if (ctx.previousStep !== 'operator') return []
  const plan = narrowEnvelope(operatorPlanOutput, ctx.previous)
  if (plan === undefined) return []
  /*
   * Checked against the registry the RUN loaded, not against a union in
   * this package: Activities are configuration now, and a trace written
   * before a team removed one would otherwise replay a chain this
   * repository can no longer run.
   */
  const offered = ctx.run.cfg.activities.map((one) => one.name)

  return plannedNames(plan).filter((name) => offered.includes(name))
}

/**
 * What to tell a person before the planned chain runs.
 *
 * Printed whether the chain was approved by a human or by the dial, because
 * "which steps am I about to pay for" is the question in both cases.
 */
export const chainNote = (steps: readonly string[]): string =>
  `operator chose: ${steps.join(' -> ')}`
