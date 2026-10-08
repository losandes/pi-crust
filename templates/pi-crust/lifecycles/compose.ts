#!/usr/bin/env bun

/**
 * pi-crust Compose — any ordered subset of the steps, named at the call site.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/compose.ts "<prompt>" --steps plan,build,verify [--run-id a1b2c3d4] [--resume]
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
import { isStepName, STEP_NAMES } from '../modules/typedefs/step'
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
export const main = (args: TWorkflowArgs): Promise<number> => {
  const names = safeParseSettlement(() => parseSteps(args.steps))
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
