/**
 * deliver: hand the work to a human in a form they can sign.
 *
 * Three modes, and the DEFAULT is not a commit.
 *
 * An unattended run that signs as you is a run that put your name on work no
 * human read. It is also the run that died here: `git commit` waited sixty
 * seconds for a 1Password touch nobody was there to give, and a chain whose
 * work was complete reported failure because the last step needed a finger.
 * Both problems have the same answer — produce something a person signs when
 * they return.
 *
 *   branch (default)  commit onto a new branch, unsigned, leaving the original
 *                     branch untouched. The work is landed and reviewable.
 *   patch             stage everything and write a .patch beside the session.
 *                     Nothing enters history until a human applies it.
 *   commit            today's behaviour, for an attended run that wants it.
 *
 * `commit_message` belongs to the envelope that wrote the code, so a chain that
 * delivers more than once never reuses one agent's sentence for another
 * agent's diff. The envelope passes straight through: delivering is not a work
 * product, so the next step still reads what the builder said.
 */

import { join } from 'node:path'
import { writeText } from '../../data/files'
import {
  branchExists,
  commitAll,
  createBranch,
  currentBranch,
  stageAll,
  stagedPatch,
} from '../../data/git'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import { activityRunParams } from '../../typedefs/activity-run'
import type { TRun } from '../../typedefs/run'
import type { TStep, TStepOptions } from '../../typedefs/step'
import { stepActivityRunName } from '../../typedefs/step'
import { recordStepResult, replayStepResult } from '../resume'

export const commitMessage = (
  run: TRun,
  envelope: TEnvelopeBase | undefined,
): string => {
  const written = (
    envelope as Readonly<{ commit_message?: string }> | undefined
  )?.commit_message
  return (
    written ||
    `crust(${run.runId}): ${envelope?.summary ?? 'changes from this run'}`
  )
}

/**
 * The branch a run delivers onto. Derived, not asked for.
 *
 * The run_id is in it because two runs delivering the same work would
 * otherwise collide silently, and a developer finding `crust/add-health` has no
 * way to tell which run wrote it.
 */
export const deliveryBranch = (run: TRun): string =>
  `crust/${run.runId}`

export const patchPath = (run: TRun): string =>
  join(run.sessionDir, `${run.runId}.patch`)

/** What `deliver` did, in the words the console and the trace both use. */
export const deliver = (
  run: TRun,
  mode: string,
  message: string,
): Readonly<Record<string, unknown>> => {
  if (mode === 'commit') {
    return { mode, sha: commitAll(message), message }
  }
  if (mode === 'patch') {
    stageAll()
    const path = patchPath(run)
    writeText(path, stagedPatch())
    return {
      mode,
      patch: path,
      message,
      note: 'staged and written as a patch; nothing entered history',
    }
  }
  const from = currentBranch()
  const branch = deliveryBranch(run)
  if (branchExists(branch)) {
    throw new Error(
      `delivery branch '${branch}' already exists. A previous run delivered ` +
        'here; rename or delete it, or deliver with --deliver patch.',
    )
  }
  createBranch(branch)
  const sha = commitAll(message)
  return { mode: 'branch', branch, from, sha, message }
}

export const commitStep = (options: TStepOptions): TStep => {
  const activityRunName = stepActivityRunName('commit', options.instance)
  return {
    name: 'commit',
    params: activityRunParams({
      name: activityRunName,
      kind: 'code',
      owner: 'git',
      description:
        'Hand the work to a human in a form they can sign, in its author\'s words',
    }),
    requires: [],

    execute: (ctx, handle) => {
      const message = commitMessage(ctx.run, ctx.previous)
      const result = deliver(ctx.run, options.deliver, message)
      handle.log(result)
      recordStepResult(ctx.run, handle, result)
      return Promise.resolve({ previous: ctx.previous, accepted: true })
    },

    replay: (ctx) => {
      const payload = replayStepResult(ctx.run, activityRunName)
      if (payload === undefined) {
        throw new Error(
          `cannot resume activityRun '${activityRunName}': this session recorded no ` +
            'delivery. Drop --resume so it runs again.',
        )
      }
      ctx.run.console.note(
        `delivery already made: ${String(payload.mode)} ` +
          `${String(payload.branch ?? payload.patch ?? payload.sha ?? '')}`,
      )
      return Promise.resolve({ previous: ctx.previous, accepted: true })
    },
  }
}
