#!/usr/bin/env bun
/**
 * pi-crust Code Review — judge the change against this repository's conventions.
 *
 * Usage:
 *     bun .pi-crust/stages/code-review.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--base <ref|range>] [--resume]
 *
 * Phases: engineer(request) -> code-reviewer [-> builder(revise) -> code-reviewer ... bounded at 2]
 *
 * The conventions live in the REPOSITORY, not in crust. `routing.skills` names
 * the review skill to load and which changed paths it applies to, and the agent
 * is told to follow whatever it finds there. Nothing about any particular
 * repository's rules is written into this tree — a repo with no such skill
 * declares none, and the agent says so rather than inventing conventions.
 *
 * The deterministic half of a code review — lint, a typed checker, whatever
 * else the skill names as blocking — is `routing.checks` and runs in `verify`.
 * An agent re-running a known command pays tokens to learn what a subprocess
 * already knows.
 *
 * `--base` names the change to judge: a ref (`HEAD~1`) or a range
 * (`main...HEAD`). Its paths are what `routing.skills` routes on, so a review
 * of committed work loads the same skills a pre-commit one would. Without it
 * the changed paths are whatever the chain changed, exactly as before.
 *
 * A rejection does not fail the phase; it fails the run.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['code-review'] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/stages/code-review.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
