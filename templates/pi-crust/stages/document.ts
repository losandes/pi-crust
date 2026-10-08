#!/usr/bin/env bun
/**
 * pi-crust Document — write up the work that was just done, from the diff.
 *
 * Usage:
 *     bun .pi-crust/stages/document.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> documenter
 *
 * The diff is captured inside the phase, against `--base` (main by default),
 * and an empty change-set throws there — before the documenter is spawned.
 * There is nothing to document until something was built.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['document'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/document.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
