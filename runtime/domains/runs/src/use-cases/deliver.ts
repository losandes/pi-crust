/**
 * Delivery is a property of an Activity, not a mode of the run.
 *
 * `--deliver branch|patch|commit` is gone. All three committed the whole
 * working tree at the END of the chain, so a large body of work arrived
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

import { resolve } from 'node:path'
import {
  errorMessage,
  safeParseSettlement,
} from '../../../../../lib/typedefs/src/settlement'
import type { TEnvelopeBase, TRun } from '../../../../lib/contracts'
import { WARNING_EVENT, warningPayload } from '../../../../lib/contracts'
import { touchedBy } from '../../../policy'
import { commitPaths } from '../../../workspace'

const firstLine = (text: string): string => text.split('\n')[0] ?? ''

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
 * Commit what this Activity produced, in its own words and nothing else.
 *
 * The scope is what the Activity Run was OBSERVED to change, not what the
 * working tree happens to hold and not what the envelope claimed. Both of
 * the alternatives are wrong in a way that costs somebody their work:
 *
 *   * the tree sweeps up every uncommitted file a developer had in progress,
 *     under a message describing something else;
 *   * the claim is a report an Activity writes about itself, and the gate
 *     that reads it only checks that each claimed file EXISTS. An Activity
 *     that under-reported would leave its own work uncommitted for the next
 *     Activity to commit under the wrong message, and one that over-reported
 *     would commit somebody else's.
 *
 * A path that was already dirty when the run started and that this Activity
 * DID write to is in scope, deliberately: a developer who starts a run to
 * finish something they began by hand would otherwise watch the Activity's
 * own work go uncommitted with no way to say "yes, that one too".
 *
 * Returns the sha, or '' when nothing was recorded — either there was
 * nothing to commit, which is not a failure, or git refused the commit, which
 * is reported as an `uncommitted` warning rather than ending the run. An
 * Activity whose gates passed without it changing a tracked file has done its
 * job; demanding a commit from it would make an empty change into an error
 * nobody can act on. A commit git cannot complete — a signing agent nobody
 * answered, a hook that exits non-zero — leaves the work in the tree for the
 * same reason `commitPaths` never puts a file back: pi-crust cannot tell an
 * agent's write from a developer's save, so it reports rather than acts.
 */
export const commitActivity = (
  run: TRun,
  instance: string,
  activityRunId: string,
  envelope: TEnvelopeBase | undefined,
  stage: string,
): string => {
  const message = commitMessage(run, envelope)
  const touched = touchedBy(run, instance)
  /*
   * `touched` is spelled relative to the WORKSPACE (or absolute, for a path
   * above it) -- the single convention `snapshotTree` normalises to. A commit
   * addresses the VCS root (1.4.1), so each path is resolved to absolute
   * first: `resolve(workspaceRoot, path)` leaves an already-absolute path
   * untouched and anchors a workspace-relative one correctly, whichever root
   * the commit itself runs from.
   */
  const atVcsRoot = touched.map((path) => resolve(run.repoRoot, path))
  const settlement = safeParseSettlement(() =>
    commitPaths(message, atVcsRoot, run.vcsRoot),
  )
  if (settlement.status === 'error') {
    run.console.note(
      `${instance}: commit failed — ${firstLine(errorMessage(settlement.error))}` +
        ` (${touched.length} path(s) left uncommitted)`,
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRunId,
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload({
        kind: 'uncommitted',
        activities: [instance],
        activityRunIds: [activityRunId],
        stage,
        paths: touched,
        note: `commit failed: ${firstLine(errorMessage(settlement.error))} — message: ${firstLine(message)}`,
      }),
    })

    return ''
  }
  const { sha, paths } = settlement.data
  if (sha === '') {
    run.console.note(`${instance}: nothing to commit`)

    return ''
  }
  run.console.note(
    `${instance} committed ${sha} (${paths.length} file(s)): ` +
      `${message.split('\n')[0]}`,
  )
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRunId,
    type: 'log',
    name: 'committed',
    // The paths, not just the count: a commit of six files and a commit of
    // sixty are otherwise indistinguishable without leaving the terminal.
    payload: { activity: instance, sha, message, paths },
  })

  return sha
}
