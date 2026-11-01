#!/usr/bin/env bun

/**
 * pi-crust Compose — execute a Lifecycle, named or spelled out.
 *
 * Usage:
 *     just crust run "<prompt>" --lifecycle sdlc [--run-id a1b2c3d4] [--resume]
 *     just crust run "<prompt>" --activities plan,test,build [--run-id a1b2c3d4] [--resume]
 *
 *     short: -a --activities, -c --commit, -l --lifecycle, -n --name,
 *            -r --resume, -id --run-id
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
 * `--lifecycle` names one from `crust.lifecycles.yaml`, whose Stages decide
 * the order. `--activities` spells the chain out at the call site, Stage by
 * Stage: `,` ends a Stage and `+` joins Activities that run at the same time.
 * Naming both is a usage error rather than a precedence rule nobody can
 * remember.
 *
 * Activity Runs: engineer(request) -> one per named activity, in the order given
 *
 * This is the escape hatch that stops the workflows directory growing a file
 * per permutation. A chain worth repeating earns its own script — a two-line
 * one, listing the same activity names — but a chain you want once lives here.
 *
 * Repeats are allowed and meaningful: `--activities build,outcome-review,build,outcome-review`
 * is a fix loop written out longhand, and the second occurrence becomes
 * `build_2` — which is also the instance its attempt budget is kept against.
 *
 * One bounded loop comes for free: a chain that ENDS in reviewing Activities
 * — any whose registry entry declares `output: reviewOutput`, under whatever
 * name a team gave them — feeds their blocking findings back to the Activity
 * that wrote the work and re-asks every one of them, bounded by that
 * Activity's `attempts`.
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../modules/typedefs/settlement'
import type { TPiCrustConfig } from '../modules/typedefs/config'
import type { TStage } from '../modules/typedefs/lifecycle'
import { loadConfigWithNotes } from '../modules/use-cases/load-config'
import { lifecycleNamed, stagePlan } from '../modules/typedefs/lifecycle'
import { parseActivities } from '../modules/use-cases/parse-activities'
import { loadLifecycles } from '../modules/use-cases/load-lifecycles'
import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { RUN_RECIPE } from '../modules/use-cases/recipe-line'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

/**
 * A bad chain is a USAGE error (exit 2), not a failed run (exit 1).
 *
 * It is settled in `main` rather than thrown, because `runCli` turns any throw
 * from a handler into exit 1 — and something will branch on the difference
 * between "you asked for an Activity that does not exist" and "the run
 * failed".
 */
/**
 * The plan to run, from whichever way the caller said it.
 *
 * Stages, not a flat list. A Lifecycle keeps the arrangement it declared, and
 * `--activities a,b,c` becomes the one serial Stage it has always meant, and
 * `a,b+c` becomes two — so both spellings reach the engine as the same kind
 * of thing, and the engine never has to ask which way it was asked for.
 */
export const plannedActivities = (
  args: TWorkflowArgs,
  cfg: TPiCrustConfig,
  lifecyclesPath?: string,
): readonly TStage[] => {
  if (args.lifecycle !== undefined && args.activities !== undefined) {
    throw new Error(
      'name a lifecycle or list the activities, not both — ' +
        `got --lifecycle ${args.lifecycle} and --activities ${args.activities}`,
    )
  }
  if (args.lifecycle === undefined && args.activities === undefined) {
    throw new Error(
      'name what to run: --lifecycle <name> for a configured Lifecycle, or ' +
        '--activities a,b,c for a chain of your own (a+b runs two at once). ' +
        '`just crust list` prints both.',
    )
  }
  if (args.lifecycle === undefined) {
    return parseActivities(args.activities, cfg.activities)
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
  await runCli(RUN_RECIPE, (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
