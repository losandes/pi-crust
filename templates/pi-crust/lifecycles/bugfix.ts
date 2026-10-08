#!/usr/bin/env bun
/**
 * pi-crust Bugfix — the lifecycle for work that starts from a symptom.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/bugfix.ts "<bug report or path/to/report.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4] [--resume]
 *
 * `sdlc` starts from a wish: someone knows what they want and the chain works
 * out how to build it. A bug report is the opposite — the outcome is already
 * agreed (it should not do that) and what nobody knows is what is actually
 * happening. Running `identify` on a symptom produces a confident outcome
 * statement derived from a guess, and nothing downstream can tell.
 *
 * So this chain opens with `diagnose`, and `test` comes BEFORE `build`: the
 * test is written from the reproduction, which means a fix that does not turn
 * a failing test green is not a fix. That ordering is the whole point of
 * having a separate lifecycle rather than a shorter sdlc.
 *
 * There is no `conceptualize` or `design`. A bug fix that needs either is not
 * a bug fix — it is a change of design, and it should be run as one.
 *
 * A diagnosis that could not reproduce the behaviour is a SUCCESS that stops
 * the chain usefully: the question goes back to a human rather than forward to
 * a builder as an invented cause.
 */

import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = [
  'diagnose',
  'plan',
  'test',
  'build',
  'verify',
  'review',
  'code-review',
] as const

export const main = (args: TWorkflowArgs): Promise<number> =>
  runWorkflow(args, STEPS)

if (import.meta.main) {
  await runCli('.pi-crust/lifecycles/bugfix.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
