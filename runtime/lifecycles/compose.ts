#!/usr/bin/env bun

/**
 * pi-crust Compose — execute a Lifecycle, named or spelled out.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/compose.ts "<prompt>" --lifecycle sdlc [--run-id a1b2c3d4] [--resume]
 *     bun .pi-crust/lifecycles/compose.ts "<prompt>" --steps plan,test,build [--run-id a1b2c3d4] [--resume]
 *
 * The Composer does not decide what is appropriate for an objective — Triage
 * and the Operator do that. It validates the plan it is handed and runs it.
 * It is the third Planner, and the only one with no agent and no entry in
 * `crust.activities.yaml`.
 *
 * What a chain may name is whatever `crust.activities.yaml` registers, and
 * nothing here: an unknown name is refused at load with the list of what was
 * available, which is the job the compiler used to do.
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
 * Repeats are allowed and meaningful: `--steps build,review,build,review` is
 * a fix loop written out longhand, and the second occurrence becomes
 * `build_2` — which is also the instance its attempt budget is kept against.
 *
 * One bounded loop comes for free: a chain whose LAST Activity is `review` or
 * `code-review` feeds the blocking findings back to the Activity that wrote
 * the work and re-reviews, bounded by that Activity's `attempts`.
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../modules/typedefs/settlement'
import { isPlannerName, PLANNER_NAMES } from '../modules/typedefs/activity'
import type { TPiCrustConfig } from '../modules/typedefs/config'
import type { TStage } from '../modules/typedefs/lifecycle'
import { loadConfigWithNotes } from '../modules/use-cases/load-config'
import { lifecycleNamed, stagePlan } from '../modules/typedefs/lifecycle'
import { asSingleStage } from '../modules/use-cases/plan-units'
import { loadLifecycles } from '../modules/use-cases/load-lifecycles'
import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

/**
 * The Activities a `--steps` list names, checked against the registry.
 *
 * Checked HERE against what this repository offers, rather than against a
 * union in the package: a team that removed an Activity must be told it is
 * gone, and a team that added one must be able to name it.
 *
 * A Planner is refused rather than resolved. A Lifecycle names Activities,
 * and a Planner is not one — it is the thing that CHOOSES them, and running
 * it from inside a chain would be a chain choosing itself.
 */
export const parseSteps = (
  steps: string | undefined,
  offered: readonly string[],
): readonly string[] => {
  const names = (steps ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length === 0) {
    throw new Error(
      '--steps is required: a comma-separated, ordered list. ' +
        `This repository offers ${offered.join(', ')}`,
    )
  }
  const planners = names.filter(isPlannerName)
  if (planners.length > 0) {
    throw new Error(
      `${planners.join(', ')} cannot be named in a chain — ` +
        `${PLANNER_NAMES.join(' and ')} CHOOSE a chain rather than being ` +
        'part of one. Run `just crust operator "…"` or ' +
        '`just crust triage "…"` instead.',
    )
  }
  const unknown = names.filter((name) => !offered.includes(name))
  if (unknown.length > 0) {
    throw new Error(
      `unknown activity(s): ${unknown.join(', ')} — this repository offers ` +
        `${offered.join(', ')}`,
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
  cfg: TPiCrustConfig,
  lifecyclesPath?: string,
): readonly TStage[] => {
  if (args.lifecycle !== undefined && args.steps !== undefined) {
    throw new Error(
      'name a lifecycle or list the steps, not both — ' +
        `got --lifecycle ${args.lifecycle} and --steps ${args.steps}`,
    )
  }
  const offered = cfg.activities.map((one) => one.name)
  if (args.lifecycle === undefined) {
    return asSingleStage(parseSteps(args.steps, offered))
  }
  const lifecycles = loadLifecycles(lifecyclesPath, cfg)
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
    plannedActivities(args, loadConfigWithNotes(args.config).config),
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
