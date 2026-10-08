#!/usr/bin/env bun
/**
 * pi-crust Prompt — the smallest workflow: one agent, one prompt, traced end-to-end.
 *
 * Usage:
 *     bun .pi-crust/stages/prompt.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> <agent>
 *
 * `--agent` picks who answers; the builder does by default.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['prompt'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/prompt.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
