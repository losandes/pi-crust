#!/usr/bin/env bun
/**
 * pi-crust Test — write the tests that would prove the request was implemented.
 *
 * Usage:
 *     bun .pi-crust/stages/test.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> tester
 *
 * Writing a test is judgement, so it is an agent. RUNNING one is a command, so
 * it is `verify`, a code phase. The two are separate steps because they are
 * separate questions, and only one of them is worth a context window.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['test'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/test.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
