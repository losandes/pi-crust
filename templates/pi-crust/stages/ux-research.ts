#!/usr/bin/env bun
/**
 * pi-crust UX Research — Establish what users need and struggle with. Changes nothing.
 *
 * Usage:
 *     bun .pi-crust/stages/ux-research.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> ux-research
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['ux-research'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/ux-research.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
