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
 *
 * A refused or timed-out commit does not stop the chain. Terminal delivery
 * retries each outstanding commit once, with signing and hooks unchanged;
 * if git still refuses, the run waits before anything is pushed. A resume
 * retries again. Recovery answers the warning on the same ordered channel.
 */

import { resolve } from 'node:path'
import { errorMessage, safeParseSettlement } from '../../../../../lib/typedefs'
import type {
  TEnvelopeBase,
  TRun,
  TTreeWarning,
} from '../../../../lib/contracts'
import {
  outstandingUncommitted,
  WARNING_EVENT,
  warningFromPayload,
  warningPayload,
} from '../../../../lib/contracts'
import { touchedBy } from '../../../policy'
import { commitPaths } from '../../../workspace'

export const COMMIT_REFUSED_EVENT = 'commit_refused'

const firstLine = (text: string): string => text.split('\n')[0] ?? ''

/** Refused commits still standing in this run's ordered warning channel. */
export const outstandingCommits = ({
  tracer,
  runId,
}: Pick<TRun, 'tracer' | 'runId'>): readonly TTreeWarning[] =>
  outstandingUncommitted(
    tracer.eventsNamed(runId, WARNING_EVENT).flatMap((payload) => {
      const warning = warningFromPayload(payload)
      return warning === undefined ? [] : [warning]
    }),
  )

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
const attemptCommit = (
  run: TRun,
  instance: string,
  activityRunId: string,
  message: string,
  stage: string,
): string => {
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
    // Git includes the whole -m argument before stderr. Collapse that argument
    // before taking a line, so the warning still names git's actual refusal.
    const failure = firstLine(
      errorMessage(settlement.error).replace(message, () => firstLine(message)),
    )
    run.console.note(
      `${instance}: commit failed — ${failure}` +
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
        note: `commit failed: ${failure} — message: ${firstLine(message)}`,
      }),
    })
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRunId,
      type: 'log',
      name: COMMIT_REFUSED_EVENT,
      payload: { activity: instance, stage, message },
    })

    return ''
  }
  const { sha, paths } = settlement.data
  if (
    outstandingCommits(run).some((warning) =>
      warning.activities.includes(instance),
    )
  ) {
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRunId,
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload({
        kind: 'recovered',
        activities: [instance],
        activityRunIds: [activityRunId],
        stage,
        paths,
        note: sha === '' ? 'nothing was left to commit' : `committed ${sha}`,
      }),
    })
  }
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

/**
 * Commit the Activity's observed paths under its envelope's whole message.
 * Refusal warns without stopping the chain; success answers any outstanding
 * warning for this Activity, including when nothing was left to commit.
 */
export const commitActivity = (
  run: TRun,
  instance: string,
  activityRunId: string,
  envelope: TEnvelopeBase | undefined,
  stage: string,
): string =>
  attemptCommit(
    run,
    instance,
    activityRunId,
    commitMessage(run, envelope),
    stage,
  )

/** Try once more every commit git refused earlier in this run. */
export const recommitRefused = (run: TRun): void => {
  const outstanding = outstandingCommits(run)
  if (outstanding.length === 0) return

  run.console.note(
    `${outstanding.length} commit(s) git refused earlier — trying each once more`,
  )
  const refusals = run.tracer.eventsNamed(run.runId, COMMIT_REFUSED_EVENT)
  outstanding.forEach((warning) => {
    const instance = warning.activities[0] ?? ''
    const refusal = refusals.findLast(
      (payload) => payload.activity === instance,
    )
    const message =
      typeof refusal?.message === 'string'
        ? refusal.message
        : commitMessage(run, undefined)
    attemptCommit(
      run,
      instance,
      warning.activityRunIds[0] ?? '',
      message,
      warning.stage,
    )
  })
}
