#!/usr/bin/env bun
/**
 * pi-crust Operator — choose the chain, then run it.
 *
 * Usage:
 *     bun .pi-crust/stages/operator.ts "<prompt or path/to/prompt.md>" [--trust-level 50] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> operator -> whatever the operator planned
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
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['operator'] as const

export const CONFLICTING_STEPS =
  'operator and --steps are competing instructions: one asks the operator to ' +
  'choose the chain, the other names it. Pick one.\n' +
  '  just crust operator "<what you want>"            # it chooses\n' +
  '  just crust compose "<what you want>" --steps a,b # you choose'

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/operator.ts', (args) => {
    /*
     * Refused rather than reconciled. Honouring one silently would mean
     * guessing which the developer meant, and the wrong guess is either a
     * chain they did not ask for or an operator whose whole job was ignored.
     */
    if (args.steps !== undefined && args.steps !== '') {
      process.stderr.write(`${CONFLICTING_STEPS}\n`)
      return Promise.resolve<number>(EXIT.USAGE)
    }
    return main(workflowArgs(args, resolvePrompt(args.prompt)))
  })
}
