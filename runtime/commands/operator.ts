#!/usr/bin/env bun

/**
 * pi-crust Operator — choose the chain, then run it.
 *
 * Usage:
 *     crust operator "<prompt or path/to/prompt.md>" [--trust-level <none|low|medium|high>] [--run-id a1b2c3d4] [--resume]
 *
 * Activity Runs: engineer(request) -> operator -> whatever the operator planned
 *
 * There is no `--execute` flag, because the trust dial already answers that
 * question and two controls for one intention is the mistake this factory
 * keeps making. Below trust 50 the chosen chain stops for you like any other
 * consequential decision; at 50 and above it runs and is reported with
 * everything else the run decided for itself.
 */

import type { TWorkflowArgs } from '../domains/cli'
import { resolvePrompt, runCli, workflowArgs } from '../domains/cli'
import { asSingleStage } from '../domains/planning'
import { runWorkflow } from '../domains/runs'
import { EXIT } from '../lib/contracts'

const ACTIVITIES = ['operator'] as const

const CONFLICTING_ACTIVITIES =
  'operator and --activities are competing instructions: one asks the ' +
  'operator to choose the chain, the other names it. Pick one.\n' +
  '  crust operator "<what you want>"                 # it chooses\n' +
  '  crust run "<what you want>" --activities a,b     # you choose'

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, asSingleStage(ACTIVITIES))

if (import.meta.main) {
  await runCli('operator', (args) => {
    if (args.models !== undefined) {
      process.stderr.write(
        '--model applies to `crust run` only — the operator chooses its activities as it goes, so which ones an override reaches cannot be known when the run starts\n',
      )
      return Promise.resolve(EXIT.USAGE)
    }
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
