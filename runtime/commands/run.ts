#!/usr/bin/env bun
import { plannedActivities } from '../domains/planning'

/**
 * pi-crust Compose — execute a Lifecycle, named or spelled out.
 *
 * Usage:
 *     crust run "<prompt>" --lifecycle ship [--run-id a1b2c3d4] [--resume]
 *     crust run "<prompt>" --activities plan,test,build [--run-id a1b2c3d4] [--resume]
 *
 *     short: -a --activities, -c --commit, -l --lifecycle, -n --name,
 *            -r --resume, -id --run-id
 *
 * The Composer does not decide what is appropriate for an objective — Triage
 * and the Operator do that. It validates the plan it is handed and runs it.
 * It is the third Planner, and the only one with no agent and no entry in
 * `crust.activities.toml`.
 *
 * What a chain may name is whatever `crust.activities.toml` registers, and
 * nothing here: an unknown name is refused at load with the list of what was
 * available, which is the job the compiler used to do.
 *
 * `--lifecycle` names one from `crust.lifecycles.toml`, whose Stages decide
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

import { errorMessage, safeParseSettlement } from '../../lib/typedefs'
import type { TCliArgs, TWorkflowArgs } from '../domains/cli'
import { RUN_RECIPE, resolvePrompt, runCli, workflowArgs } from '../domains/cli'
import { loadConfigWithNotes } from '../domains/config'
import { runWorkflow } from '../domains/runs'

const runPlan = (args: TWorkflowArgs): Promise<number> => {
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

/** Resolve the prompt and hand off to `main` \u2014 the shape `runCli` wants. */
export const main = (args: TCliArgs): Promise<number> =>
  runPlan(workflowArgs(args, resolvePrompt(args.prompt)))

if (import.meta.main) await runCli(RUN_RECIPE, main)
