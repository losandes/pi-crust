#!/usr/bin/env bun
/**
 * pi-crust Verify — run the deterministic checks the changed paths select.
 *
 * Usage:
 *     bun .pi-crust/stages/verify.ts "<why you are verifying>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--base <ref|range>] [--resume]
 *
 * Phases: engineer(request) -> code(verify)
 *
 * Which commands run is `routing.checks` in crust.config.yaml, selected by the
 * paths the change actually touched — tests, lint, typecheck, and whatever
 * blocking checkers this repository's own conventions name. No command is
 * written into this tree, because crust is stamped into repositories whose
 * toolchain it cannot know.
 *
 * `--base` names the change to check: a ref (`HEAD~1`) or a range
 * (`main...HEAD`). Without it the uncommitted working tree is read, exactly as
 * before — so committed work can be verified too, and a base that selects no
 * file fails rather than passing every check vacuously.
 *
 * A failing check does not fail the PHASE: the runner did its job. It fails the
 * RUN, which is what the exit code reports.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['verify'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/verify.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
