#!/usr/bin/env bun

/**
 * pi-crust Compose — execute a Lifecycle, named or spelled out.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/compose.ts "<prompt>" --lifecycle sdlc [--run-id a1b2c3d4] [--resume]
 *     bun .pi-crust/lifecycles/compose.ts "<prompt>" --steps plan,build,verify [--run-id a1b2c3d4] [--resume]
 *
 * The Composer does not decide what is appropriate for an objective — Triage
 * and the Operator do that. It validates the plan it is handed and runs it.
 *
 * `--lifecycle` names one from `crust.lifecycles.yaml`, whose Stages and
 * dependencies decide the order. `--steps` spells the Activities out at the
 * call site. Naming both is a usage error rather than a precedence rule
 * nobody can remember.
 *
 * Activity Runs: engineer(request) -> one per named step, in the order given
 *
 * This is the escape hatch that stops the workflows directory growing a file
 * per permutation. A chain worth repeating earns its own script — a two-line
 * one, listing the same step names — but a chain you want once lives here.
 *
 * Repeats are allowed and meaningful: `--steps build,verify,build,verify` is a
 * fix loop written out longhand, and the second occurrence becomes `build_2`.
 *
 * One bounded loop comes for free: a chain whose LAST step is `review` or
 * `code-review` feeds the blocking findings back to the builder and re-reviews,
 * at most twice. `revise` is also nameable on its own — `--steps review,revise`
 * is a single pass with no re-review — for when you want one and not the loop.
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../modules/typedefs/settlement'
import type { TAgentConfig } from '../modules/typedefs/config'
import type { TStage } from '../modules/typedefs/lifecycle'
import { loadConfigWithNotes } from '../modules/use-cases/load-config'
import { lifecycleNamed, stagePlan } from '../modules/typedefs/lifecycle'
import { asSingleStage } from '../modules/use-cases/plan-units'
import { isStepName, STEP_NAMES } from '../modules/typedefs/step'
import { loadLifecycles } from '../modules/use-cases/load-lifecycles'
import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const parseSteps = (steps: string | undefined): readonly string[] => {
  const names = (steps ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length === 0) {
    throw new Error(
      '--steps is required: a comma-separated, ordered list. ' +
        `Valid steps are ${STEP_NAMES.join(', ')}`,
    )
  }
  const unknown = names.filter((name) => !isStepName(name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown step(s): ${unknown.join(', ')} — valid steps are ` +
        `${STEP_NAMES.join(', ')}`,
    )
  }
  return names
}

/**
 * A bad step list is a USAGE error (exit 2), not a failed run (exit 1).
 *
 * It is settled here rather than thrown, because `runCli` turns any throw from
 * a handler into exit 1 — and something will branch on the difference between
 * "you asked for a step that does not exist" and "the run failed".
 */
/**
 * The plan to run, from whichever way the caller said it.
 *
 * Stages, not a flat list. A Lifecycle keeps the arrangement it declared, and
 * `--steps a,b,c` becomes the one serial Stage it has always meant — so both
 * spellings reach the engine as the same kind of thing, and the engine never
 * has to ask which way it was asked for.
 */
export const plannedActivities = (
  args: TWorkflowArgs,
  lifecyclesPath?: string,
  agents: readonly TAgentConfig[] = [],
): readonly TStage[] => {
  if (args.lifecycle !== undefined && args.steps !== undefined) {
    throw new Error(
      'name a lifecycle or list the steps, not both — ' +
        `got --lifecycle ${args.lifecycle} and --steps ${args.steps}`,
    )
  }
  if (args.lifecycle === undefined) {
    return asSingleStage(parseSteps(args.steps))
  }
  const lifecycles = loadLifecycles(lifecyclesPath, agents)
  const found = lifecycleNamed(lifecycles, args.lifecycle)
  if (found === undefined) {
    throw new Error(
      `unknown lifecycle: ${args.lifecycle} — this repository offers ` +
        `${lifecycles.map((one) => one.name).join(', ')}`,
    )
  }
  const stages = stagePlan(found)
  if (stages.every((stage) => stage.activities.length === 0)) {
    throw new Error(
      `lifecycle '${args.lifecycle}' declares no activities to run`,
    )
  }
  return stages
}

export const main = (args: TWorkflowArgs): Promise<number> => {
  /*
   * The roster is read here only so a concurrency claim can be checked
   * against it before anything starts. `runWorkflow` reads the config again
   * for the run itself, which is one read more than strictly needed and the
   * alternative is threading a half-loaded config through a planner whose
   * job is to answer a question about a file.
   */
  const planned = safeParseSettlement(() =>
    plannedActivities(
      args,
      undefined,
      loadConfigWithNotes(args.config).config.agents,
    ),
  )
  if (planned.status === 'error') {
    process.stderr.write(`${errorMessage(planned.error)}\n`)
    return Promise.resolve(2)
  }
  return runWorkflow(args, planned.data)
}

if (import.meta.main) {
  await runCli('.pi-crust/lifecycles/compose.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
