#!/usr/bin/env bun
/**
 * pi-crust Commit — land the working tree in the words of whoever last wrote it.
 *
 * Usage:
 *     bun .pi-crust/stages/commit.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> git(commit)
 *
 * On its own this commits the working tree with a generated subject. In a
 * chain it uses the preceding envelope's `commit_message`.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['commit'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/commit.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
