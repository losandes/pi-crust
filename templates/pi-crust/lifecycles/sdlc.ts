#!/usr/bin/env bun
/**
 * pi-crust SDLC — the whole lifecycle, identify through code-review.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/sdlc.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--base <ref|range>] [--resume]
 *
 * Phases: engineer(request) -> analyst -> solutions-architect -> planner -> technical-architect -> tester -> builder -> code(verify) -> reviewer -> code-reviewer [-> builder(revise) -> code-reviewer ... bounded at 2]
 *
 * The lifecycle in `adr/context/sdlc.md`, stage for stage: what outcome is
 * wanted and how success is recognised; what the solution must mean; what to
 * build in what order; how it physically exists here; what would prove it; the
 * work; the deterministic checks; then the two judgements — is this what was
 * asked for, and does it conform to this repository's conventions.
 *
 * It is DELIBERATELY the expensive chain. Nine agent calls buy the thing a
 * short chain cannot: success criteria written before anyone builds, a logical
 * model decided before a schema settles it, and a reviewer with something
 * other than its own opinion to rule against. For work whose shape is already
 * known, `compose --steps plan,build,verify` is three calls and still verified.
 *
 * `poc` is not here. The record says to run one when evidence cannot cheaply
 * resolve a material uncertainty, which is a judgement — so it is reached
 * deliberately, through `de-risk` or `compose`, and never by default.
 *
 * It ends in a bounded revise loop rather than in a verdict. Because the last
 * step is a review, every blocking finding goes back to the builder, who fixes
 * it or disputes it with evidence, and the code-reviewer rules again — at most
 * twice. A finding repeated with nothing new on either side stops the loop and
 * lands in context_handoff/disputes.md for the developer.
 *
 * Nothing is committed. A green run leaves the tree ready for a `commit` step
 * or for the developer; a red one leaves the evidence where it fell.
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
  'test',
  'build',
  'verify',
  'review',
  'code-review',
] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/lifecycles/sdlc.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
