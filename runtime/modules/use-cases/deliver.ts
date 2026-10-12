/**
 * Delivery is a property of an Activity, not a mode of the run.
 *
 * `--deliver branch|patch|commit` is gone. All three performed one
 * `commitAll` at the END of the chain, so a large body of work arrived
 * squashed whichever was chosen — the limitation was the shape of the activity,
 * not the mode. An Activity that declares `commit: true` commits its own
 * change the moment its gates have passed, so granularity follows the chain:
 * several writing Activities produce several commits, each in the words of
 * the envelope that wrote it.
 *
 * `--commit false` disables committing for a whole run, whatever the
 * registry declares. There is no `--commit true`: a flag granting a
 * permission the configuration withheld would make a run behave in a way
 * nobody reading the registry could predict.
 */

import { commitAll, isDirty } from '../data/git'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'

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
 * Commit what this Activity produced, in its own words.
 *
 * Returns the sha, or '' when there was nothing to commit — which is not a
 * failure. An Activity whose gates passed without it changing a tracked file
 * has done its job; demanding a commit from it would make an empty change
 * into an error nobody can act on.
 */
export const commitActivity = (
  run: TRun,
  instance: string,
  activityRunId: string,
  envelope: TEnvelopeBase | undefined,
): string => {
  if (!isDirty()) {
    run.console.note(`${instance}: nothing to commit`)

    return ''
  }
  const message = commitMessage(run, envelope)
  const sha = commitAll(message)
  run.console.note(`${instance} committed ${sha}: ${message.split('\n')[0]}`)
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRunId,
    type: 'log',
    name: 'committed',
    payload: { activity: instance, sha, message },
  })

  return sha
}
