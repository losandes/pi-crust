#!/usr/bin/env bun
/**
 * pi-crust Review — confirm that what was built is what was asked for.
 *
 * Usage:
 *     bun .pi-crust/stages/review.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--base <ref|range>] [--resume]
 *
 * Phases: engineer(request) -> reviewer [-> builder(revise) -> reviewer ... bounded at 2]
 *
 * Not testing, and not code review. This asks only whether each requirement in
 * the spec is met by the code on disk.
 *
 * `--base` names the change to judge: a ref (`HEAD~1`) or a range
 * (`main...HEAD`). Without it the reviewer reads what the chain changed, which
 * on a one-step run is the working tree — exactly as before.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['review'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/review.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
