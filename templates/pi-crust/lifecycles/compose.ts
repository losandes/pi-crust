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
 * Phases: engineer(request) -> one per named step, in the order given
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
import { activityOrder, lifecycleNamed } from '../modules/typedefs/lifecycle'
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
 * The Activities to run, from whichever way the caller said it.
 *
 * A Lifecycle is resolved and flattened here rather than inside the engine,
 * so that a named Lifecycle and the same list spelled out reach the runner
 * as the same thing and produce the same trace.
 */
export const plannedActivities = (
  args: TWorkflowArgs,
  lifecyclesPath?: string,
): readonly string[] => {
  if (args.lifecycle !== undefined && args.steps !== undefined) {
    throw new Error(
      'name a lifecycle or list the steps, not both — ' +
        `got --lifecycle ${args.lifecycle} and --steps ${args.steps}`,
    )
  }
  if (args.lifecycle === undefined) {
    return parseSteps(args.steps)
  }
  const lifecycles = loadLifecycles(lifecyclesPath)
  const found = lifecycleNamed(lifecycles, args.lifecycle)
  if (found === undefined) {
    throw new Error(
      `unknown lifecycle: ${args.lifecycle} — this repository offers ` +
        `${lifecycles.map((one) => one.name).join(', ')}`,
    )
  }
  const names = activityOrder(found)
  if (names.length === 0) {
    throw new Error(
      `lifecycle '${args.lifecycle}' declares no activities to run`,
    )
  }
  return names
}

export const main = (args: TWorkflowArgs): Promise<number> => {
  const names = safeParseSettlement(() => plannedActivities(args))
  if (names.status === 'error') {
    process.stderr.write(`${errorMessage(names.error)}\n`)
    return Promise.resolve(2)
  }
  return runWorkflow(args, names.data)
}

if (import.meta.main) {
  await runCli('.pi-crust/lifecycles/compose.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
