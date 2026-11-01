/**
 * The Planners, as activities. A closed set, deliberately.
 *
 * Triage and the Operator answer the same question — what should happen —
 * and differ in what becomes of the answer: the Operator's chain is executed
 * in the run that chose it, Triage's is handed back as a command. That
 * difference is why they are two Planners rather than one with a flag: a
 * reader of a trace can see that nothing was going to follow `triage`
 * without knowing which flags the run started with.
 *
 * Configuration tunes them — model, thinking, tools, writes, prompts — and
 * cannot add one, because a Planner is wired into the engine rather than
 * named by a Lifecycle. Their work configuration is here for the same
 * reason: `stepsValid` is not a preference. An invented Activity name in a
 * plan is not a weak recommendation, it is a run that cannot start, and the
 * gate hands the Planner its own mistake inside the same session.
 */

import { DEFAULT_ATTEMPTS } from '../../typedefs/activity'
import type { TPlannerConfig } from '../../typedefs/activity'
import { operatorPlanOutput } from '../../typedefs/envelope'
import type { TActivity, TActivityOptions } from '../../typedefs/runnable-activity'
import { stepsValid } from '../gates'
import { agentActivity } from './agent-activity'

export const plannerActivity = (
  planner: TPlannerConfig,
  options: TActivityOptions,
): TActivity =>
  agentActivity(
    {
      config: {
        ...planner,
        output: operatorPlanOutput.name,
        gates: ['stepsValid'],
        input: 'upstream',
        attempts: DEFAULT_ATTEMPTS,
        commit: false,
        aliases: [],
      },
      spec: operatorPlanOutput,
      gates: [stepsValid],
    },
    options,
  )
