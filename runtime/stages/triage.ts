#!/usr/bin/env bun
/**
 * pi-crust Triage — choose the chain, and hand it back.
 *
 * Usage:
 *     bun .pi-crust/stages/triage.ts "<prompt or path/to/prompt.md>" [--run-id a1b2c3d4] [--resume]
 *
 * Phases: engineer(request) -> triage. Nothing follows, by construction.
 *
 * The operator chooses a chain and the run executes it. This chooses the
 * same chain and prints the command, which is a different thing to want
 * rather than a cautious version of the same thing: the reasoning in
 * `plan.md` is the deliverable, and the command is how you act on it after
 * reading — or after editing the list, which is the point of being handed a
 * line instead of a running process.
 *
 * There is no trust dial here. Trust decides what a run may do without
 * asking; a run that does nothing has nothing to ask about.
 */

import { resolve } from 'node:path'
import { newId } from '../modules/data/ids'
import { dbPathFromEnv } from '../modules/data/env-overrides'
import { DEFAULT_DB } from '../modules/typedefs/config'
import type { TWorkflowArgs } from '../modules/use-cases/parse-cli'
import { runCli, workflowArgs } from '../modules/use-cases/parse-cli'
import { adviceCommand } from '../modules/use-cases/advice'
import { loadConfig } from '../modules/use-cases/load-config'
import { readRunState } from '../modules/use-cases/read-run-state'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { asSingleStage } from '../modules/use-cases/plan-units'
import { runWorkflow } from '../modules/use-cases/run-workflow'

export const STEPS = ['triage'] as const

export const main = async (args: TWorkflowArgs): Promise<number> => {
  /*
   * The run id is minted HERE when the developer did not give one, because
   * the command this stage prints has to be read back out of the trace the
   * run just wrote — and a stage that let the id be generated below it
   * would have to guess which run was its own.
   */
  const withId: TWorkflowArgs = { ...args, runId: args.runId ?? newId(8) }
  const code = await runWorkflow(withId, asSingleStage(STEPS))
  /*
   * Printed after the run rather than by the agent, because the agent is
   * not the authority on how this factory is invoked: it chose the steps,
   * and the shape of the command belongs to the code that knows what
   * `compose` takes today.
   */
  const cfg = loadConfig(withId.config)
  const dbPath = resolve(dbPathFromEnv() ?? cfg.observability.db ?? DEFAULT_DB)
  const state = readRunState(dbPath, withId.runId)
  const command =
    state === undefined ? undefined : adviceCommand(state, args.prompt)
  if (command !== undefined) {
    process.stdout.write(`\n${command}\n`)
  }
  return code
}

if (import.meta.main) {
  await runCli('.pi-crust/stages/triage.ts', (args) =>
    main(workflowArgs(args, resolvePrompt(args.prompt))),
  )
}
