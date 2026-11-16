/**
 * Settle terminal delivery: cancel, retry refused commits, wait, or judge its gates.
 *
 * A terminal Activity never enters the fold — `runWorkflow` calls this once,
 * after `runReviseLoop` has returned and before `finish`. The cancelled path
 * records its own row directly, because `runActivityRun` only ever settles
 * `success` or `fail` and `cancelled` is neither: nothing ran, nothing was
 * attempted, and the row says so without pretending a body executed.
 *
 * Delivery waits before pushing if a retried commit is still outstanding,
 * or after an operator-recoverable refusal. Other results face engine-owned
 * delivery gates. Resuming supersedes only this terminal's fail/waiting rows.
 */

import type {
  TActivityContext,
  TActivityRun,
  TRun,
} from '../../../../lib/contracts'
import { violationsOf } from '../../../../lib/contracts'
import { nowIso } from '../../../../lib/system'
import type { TTerminalActivity } from '../../../activities'
import { DELIVERY_GATES } from '../../../gates'
import { outstandingCommits, recommitRefused } from './deliver'
import type { TGateReason } from './human-gate'
import { resumeInvocation, writeDecisionRequest } from './human-gate'
import { counts, runActivityRun } from './run-activity-run'

export type TRunTerminalParams = Readonly<{
  run: TRun
  activity: TTerminalActivity
  ctx: TActivityContext
  accepted: boolean
  reason?: string
  rejectedBy?: string
}>

export type TTerminalOutcome =
  | Readonly<{ kind: 'settled' }>
  | Readonly<{ kind: 'waiting'; request: string }>

const retryableTerminal = (
  activity: Pick<TTerminalActivity, 'name'>,
  row: Pick<TActivityRun, 'params' | 'status'>,
): boolean =>
  row.params.name === activity.name &&
  (row.status === 'fail' || row.status === 'waiting')

const waitForDelivery = (
  {
    runId,
    contextHandoffDir,
    tracer,
    console: reporter,
  }: Pick<TRun, 'runId' | 'contextHandoffDir' | 'tracer' | 'console'>,
  reason: Extract<TGateReason, { kind: 'delivery' }>,
  activityRunId: string,
): TTerminalOutcome => {
  const request = writeDecisionRequest(
    contextHandoffDir,
    reason,
    runId,
    resumeInvocation(process.argv, runId),
  )
  const detail =
    reason.cause === 'uncommitted'
      ? `${reason.outstanding.length} commit(s) git refused are still outstanding`
      : reason.refusal
  reporter.note(`${reason.activity}: waiting for you — ${detail} — ${request}`)
  tracer.event({
    run_id: runId,
    activity_run_id: activityRunId,
    type: 'log',
    name: 'human_gate_open',
    payload: {
      activity: reason.activity,
      kind: reason.kind,
      cause: reason.cause,
      request,
      activities: reason.outstanding.flatMap((warning) => warning.activities),
      refusal: reason.refusal,
    },
  })
  return { kind: 'waiting', request }
}

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
): Promise<TTerminalOutcome> => {
  const { run, activity, ctx, accepted } = params
  // Like finish, judge the persisted trace, including earlier processes.
  const previous = run.tracer.activityRunsFor(run.runId)
  if (
    previous
      .filter(counts)
      .some(
        (row) => row.status !== 'success' && !retryableTerminal(activity, row),
      )
  ) {
    recordCancelled(run, activity, 'a counted activity run in this run failed')
    return { kind: 'settled' }
  }
  if (params.rejectedBy !== undefined) {
    recordCancelled(
      run,
      activity,
      `the person rejected the run — ${params.rejectedBy}`,
    )
    return { kind: 'settled' }
  }
  if (!accepted) {
    const reason: TGateReason = {
      kind: 'acceptance',
      activity: activity.name,
      detail: params.reason ?? 'The run did not meet its acceptance criterion.',
    }
    const request = writeDecisionRequest(
      run.contextHandoffDir,
      reason,
      run.runId,
      resumeInvocation(process.argv, run.runId),
    )
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: '',
      type: 'log',
      name: 'human_gate_open',
      payload: { ...reason, opened_at: nowIso(), request },
    })
    run.console.note(
      `${activity.name}: waiting for acceptance — ${reason.detail} — ${request}`,
    )
    return { kind: 'waiting', request }
  }
  previous
    .filter((row) => retryableTerminal(activity, row))
    .forEach((row) => {
      run.tracer.activityRunUpsert({ ...row, status: 'superseded' })
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: row.activity_run_id,
        type: 'log',
        name: 'terminal_superseded',
        payload: {
          activity: activity.name,
          reason: 'the terminal Activity is running again',
        },
      })
    })

  recommitRefused(run)
  const outstanding = outstandingCommits(run)
  if (outstanding.length > 0) {
    return waitForDelivery(
      run,
      {
        kind: 'delivery',
        activity: activity.name,
        cause: 'uncommitted',
        outstanding,
        refusal: '',
      },
      '',
    )
  }

  const { result, activityRun } = await runActivityRun(run)(
    activity.params,
    async (handle) => ({
      result: await activity.deliver(ctx, handle),
      activityRun: handle.activityRun,
    }),
  )
  if (result.recoverable) {
    const waiting = run.updateActivityRun(activityRun.activity_run_id, {
      status: 'waiting',
    })
    run.tracer.activityRunUpsert(waiting)
    return waitForDelivery(
      run,
      {
        kind: 'delivery',
        activity: activity.name,
        cause: 'forge',
        outstanding: [],
        refusal: result.reason,
      },
      activityRun.activity_run_id,
    )
  }

  const violations = DELIVERY_GATES.flatMap((gate) => {
    const report = gate.check({ result })
    const violations = violationsOf(report)
    run.tracer.gateRow(activityRun, gate.name, report)
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun.activity_run_id,
      type: violations.length > 0 ? 'gate_fail' : 'gate_pass',
      name: gate.name,
      payload: { violations, checks: report.checks },
    })
    run.console.gateResult(gate.name, report)
    return violations
  })
  if (violations.length > 0) {
    const failed = run.updateActivityRun(activityRun.activity_run_id, {
      status: 'fail',
      error: `failed its gates: ${violations.join('; ')}`.slice(0, 1000),
    })
    run.tracer.activityRunUpsert(failed)
    run.console.note(
      `${activity.name}: failed its gates — fix what they name, then resume: ${resumeInvocation(process.argv, run.runId)}`,
    )
  }
  return { kind: 'settled' }
}
