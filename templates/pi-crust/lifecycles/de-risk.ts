#!/usr/bin/env bun
/**
 * pi-crust De-risk — decide what it means, then buy the answer before committing to it.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/de-risk.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> analyst -> solutions-architect -> planner -> technical-architect -> builder(poc)
 *
 * The front half of `sdlc`, ending in a proof of concept instead of in a
 * build. Use it when the expensive uncertainty is whether the approach works
 * at all — a dependency that may not behave, an integration nobody here has
 * made before, a performance claim taken on trust.
 *
 * The POC comes LAST on purpose. A hypothesis is only worth testing once
 * somebody has said what the solution must mean and how it would physically
 * exist, because until then there is nothing specific enough to disprove and
 * the POC answers a question nobody asked. Identify, conceptualize, plan and
 * design cost four agent calls and make the fifth one answerable.
 *
 * A POC that DISPROVES its hypothesis is a success: it bought the answer for
 * the price of five calls instead of a full build. That is the whole point of
 * running this chain rather than `sdlc` — and the reason the run ends here,
 * with a decision for a human, rather than carrying on into code written
 * against an assumption that just died.
 *
 * Nothing is committed, and the POC's code is not the implementation. Whatever
 * it proves, the build that follows starts from the plan, not from the spike.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = [
  'identify',
  'conceptualize',
  'plan',
  'design',
  'poc',
] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/lifecycles/de-risk.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
