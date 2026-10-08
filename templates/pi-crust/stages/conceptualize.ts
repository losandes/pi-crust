#!/usr/bin/env bun
/**
 * pi-crust Conceptualize — 1.3 Conceptualize — decide what the solution must mean and do.
 *
 * Usage:
 *     bun .pi-crust/stages/conceptualize.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> solutions-architect

 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['conceptualize'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/conceptualize.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
