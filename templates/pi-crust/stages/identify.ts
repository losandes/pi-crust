#!/usr/bin/env bun
/**
 * pi-crust Identify — 1.2 Identify — turn a problem into an outcome with success criteria.
 *
 * Usage:
 *     bun .pi-crust/stages/identify.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> analyst

 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['identify'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/identify.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
