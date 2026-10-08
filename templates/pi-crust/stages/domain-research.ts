#!/usr/bin/env bun
/**
 * pi-crust Domain Research — Model the domain and the rules that govern it. Changes nothing.
 *
 * Usage:
 *     bun .pi-crust/stages/domain-research.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> domain-research
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['domain-research'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/domain-research.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
