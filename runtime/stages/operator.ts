#!/usr/bin/env bun
/**
 * pi-crust Operator — choose the chain, then run it.
 *
 * Usage:
 *     just crust operator "<prompt or path/to/prompt.md>" [--trust-level 50] [--run-id a1b2c3d4] [--resume]
 *
 * Activity Runs: engineer(request) -> operator -> whatever the operator planned
 *
 * There is no `--execute` flag, because the trust dial already answers that
 * question and two controls for one intention is the mistake this factory
 * keeps making. Below trust 50 the chosen chain stops for you like any other
 * consequential decision; at 50 and above it runs and is reported with
 * everything else the run decided for itself.
 */

import { EXIT } from '../modules/typedefs/run-state'
import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { asSingleStage } from '../modules/use-cases/plan-units'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const ACTIVITIES = ['operator'] as const

export const CONFLICTING_ACTIVITIES =
  'operator and --activities are competing instructions: one asks the ' +
  'operator to choose the chain, the other names it. Pick one.\n' +
  '  just crust operator "<what you want>"                 # it chooses\n' +
  '  just crust run "<what you want>" --activities a,b     # you choose'

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, asSingleStage(ACTIVITIES))

if (import.meta.main) {
  await runCli('operator', (args) => {
    /*
     * Refused rather than reconciled. Honouring one silently would mean
     * guessing which the developer meant, and the wrong guess is either a
     * chain they did not ask for or an operator whose whole job was ignored.
     */
    if (args.activities !== undefined && args.activities !== '') {
      process.stderr.write(`${CONFLICTING_ACTIVITIES}\n`)
      return Promise.resolve<number>(EXIT.USAGE)
    }
    return main(workflowArgs(args, resolvePrompt(args.prompt)))
  })
}
