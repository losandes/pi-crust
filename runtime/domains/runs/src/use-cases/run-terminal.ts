/**
 * Settle a terminal Activity: cancel it, or run it for real.
 *
 * A terminal Activity never enters the fold — `runWorkflow` calls this once,
 * after `runReviseLoop` has returned and before `finish`. The cancelled path
 * records its own row directly, because `runActivityRun` only ever settles
 * `success` or `fail` and `cancelled` is neither: nothing ran, nothing was
 * attempted, and the row says so without pretending a body executed.
 */

import type {
  TActivityContext,
  TActivityRun,
  TRun,
} from '../../../../lib/contracts'
import { nowIso } from '../../../../lib/system'
import type { TTerminalActivity } from '../../../activities'
import { counts, runActivityRun } from './run-activity-run'

export type TRunTerminalParams = Readonly<{
  run: TRun
  activity: TTerminalActivity
  ctx: TActivityContext
  accepted: boolean
}>

/**
 * A counted activity run that did not succeed, anywhere in this run's trace.
 *
 * Read through the tracer rather than the in-memory list this process
 * accumulated, for the same reason `finish` does: a resumed process judges
 * the whole run, not just the leg it ran itself.
 */
const anyCountedFailed = (run: TRun): boolean =>
  run.tracer
    .activityRunsFor(run.runId)
    .filter(counts)
    .some((activityRun) => activityRun.status !== 'success')

const recordCancelled = (
  run: TRun,
  activity: TTerminalActivity,
  reason: string,
): void => {
  const seq = run.nextSeq()
  const activityRun: TActivityRun = {
    activity_run_id: `${run.runId}_${String(seq).padStart(2, '0')}_${activity.params.name}`,
    run_id: run.runId,
    seq,
    params: activity.params,
    status: 'cancelled',
    error: undefined,
    started_at: nowIso(),
    ended_at: nowIso(),
  }
  run.recordActivityRun(activityRun)
  run.tracer.activityRunUpsert(activityRun)
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'activity_run_start',
    name: activity.params.name,
    payload: {
      kind: activity.params.kind,
      owner: activity.params.owner,
      description: activity.params.description,
    },
  })
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'log',
    name: 'terminal_cancelled',
    payload: { activity: activity.params.name, reason },
  })
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun.activity_run_id,
    type: 'activity_run_end',
    name: activity.params.name,
    payload: { status: 'cancelled' },
  })
  run.console.note(`${activity.params.name}: cancelled — ${reason}`)
}

export const runTerminal = async (
  params: TRunTerminalParams,
): Promise<void> => {
  const { run, activity, ctx, accepted } = params
  if (!accepted) {
    recordCancelled(
      run,
      activity,
      'the run was not accepted — a activity did not meet its own criterion',
    )
    return
  }
  if (anyCountedFailed(run)) {
    recordCancelled(run, activity, 'a counted activity run in this run failed')
    return
  }
  await runActivityRun(run)(activity.params, (handle) =>
    activity.deliver(ctx, handle),
  )
}
