#!/usr/bin/env bun
/**
 * pi-crust Triage — choose the chain, and hand it back.
 *
 * Usage:
 *     just crust triage "<prompt or path/to/prompt.md>" [--run-id a1b2c3d4] [--resume]
 *
 * Activity Runs: engineer(request) -> triage. Nothing follows, by construction.
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

import type { TWorkflowArgs } from '../domains/cli'
import {
  findFollowUpCommand,
  resolvePrompt,
  runCli,
  workflowArgs,
} from '../domains/cli'
import { loadConfig } from '../domains/config'
import { asSingleStage } from '../domains/planning'
import { runWorkflow } from '../domains/runs'
import { repoRoot } from '../domains/workspace'
import { EXIT } from '../lib/contracts'
import { newId } from '../lib/system'

const ACTIVITIES = ['triage'] as const

export const main = async (args: TWorkflowArgs): Promise<number> => {
  /*
   * The run id is minted HERE when the developer did not give one, because
   * the command this stage prints has to be read back out of the trace the
   * run just wrote — and a stage that let the id be generated below it
   * would have to guess which run was its own.
   */
  const runId = args.runId ?? newId(8)
  const withId: TWorkflowArgs = { ...args, runId }
  const code = await runWorkflow(withId, asSingleStage(ACTIVITIES))
  /*
   * Printed after the run rather than by the agent, because the agent is
   * not the authority on how this factory is invoked: it chose the activities,
   * and the shape of the command belongs to the code that knows what
   * `compose` takes today.
   */
  const command = findFollowUpCommand({
    repoRoot: repoRoot(),
    env: process.env,
  })(loadConfig(withId.config), runId, args.prompt)
  if (command !== undefined) {
    process.stdout.write(`\n${command}\n`)
  }
  return code
}

if (import.meta.main) {
  await runCli('triage', (args) => {
    if (args.models !== undefined) {
      process.stderr.write(
        '--model applies to `just crust run` only — the triage chooses its activities as it goes, so which ones an override reaches cannot be known when the run starts\n',
      )
      return Promise.resolve(EXIT.USAGE)
    }
    return main(workflowArgs(args, resolvePrompt(args.prompt)))
  })
}
