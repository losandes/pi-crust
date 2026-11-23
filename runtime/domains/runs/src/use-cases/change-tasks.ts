import { mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import type { TActivity, TActivityRun, TRun } from '../../../../lib/contracts'
import {
  violationsOf,
  WARNING_EVENT,
  warningPayload,
} from '../../../../lib/contracts'
import { ensureDir } from '../../../../lib/system'
import { runStartIn, touchedBy } from '../../../policy'
import type { TChangeTasksParams } from '../../../tasks'
import {
  changeReport,
  liveTaskPorts,
  runChangeTasks,
  taskArtifactName,
} from '../../../tasks'

const reserveDirectory = (parent: string, index = 1): string => {
  const path = join(parent, String(index).padStart(3, '0'))
  const reserved = safeParseSettlement(() => mkdirSync(path))
  if (reserved.status === 'ok') return path
  if ('code' in reserved.error && reserved.error.code === 'EEXIST')
    return reserveDirectory(parent, index + 1)
  throw reserved.error
}

export const evaluationArtifact = (handoff: string) => {
  // Lazy because a settlement with no selected task writes no directory.
  let directory: string | undefined
  return (task: Parameters<typeof taskArtifactName>[0]): string => {
    directory ??= reserveDirectory(ensureDir(join(handoff, 'tasks')))
    return join(directory, taskArtifactName(task))
  }
}

export type TTaskRowLookup = (instance: string) => TActivityRun | undefined

export const rowFor =
  (run: TRun): TTaskRowLookup =>
  (instance: string) =>
    run.activityRuns().findLast((row) => row.params.name === instance)

export const recordTaskCommands = (
  run: TRun,
  options: Readonly<{
    findRow: TTaskRowLookup
    moment?: 'deliver' | 'before' | 'after'
  }>,
): Pick<TChangeTasksParams, 'onCommandStart' | 'onCommandEnd'> => ({
  onCommandStart: ({ task, command }) =>
    run.console.note(`task ${task}: ${command}`),
  onCommandEnd: ({
    task,
    result,
    outputArtifact,
    instances,
    startedAt,
    endedAt,
  }) => {
    const row = options.findRow(instances[0] ?? '')
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: row?.activity_run_id ?? '',
      type: 'tool_call',
      name: `task:${task}`,
      payload: {
        task,
        command: result.command,
        returncode: result.returncode,
        passed: result.passed,
        timed_out: result.timedOut,
        duration_seconds: result.durationSeconds,
        output_artifact: outputArtifact,
        instances,
        ...(options.moment === undefined ? {} : { moment: options.moment }),
      },
      started_at: startedAt,
      ended_at: endedAt,
    })
  },
})

export const changeTasks =
  (run: TRun) => async (activities: readonly TActivity[]) => {
    const findRow = rowFor(run)
    const contributions = activities.map((activity) => ({
      instance: activity.instance,
      activity:
        activity.params.kind === 'agent'
          ? activity.params.owner
          : activity.name,
      paths: touchedBy(run, activity.instance).map((path) =>
        relative(run.vcsRoot, resolve(run.repoRoot, path)),
      ),
    }))
    const outcome = await runChangeTasks(liveTaskPorts)({
      cfg: run.cfg,
      root: run.vcsRoot,
      baseRef: runStartIn(run)?.head ?? '',
      contributions,
      artifactFor: evaluationArtifact(run.contextHandoffDir),
      ...recordTaskCommands(run, { findRow }),
    })
    return new Map(
      contributions.map(({ instance }) => {
        const report = changeReport(outcome, instance)
        const row = findRow(instance)
        const violations = report === undefined ? [] : violationsOf(report)
        if (report !== undefined && row !== undefined) {
          run.tracer.gateRow(row, 'tasks', report)
          run.tracer.event({
            run_id: run.runId,
            activity_run_id: row.activity_run_id,
            type: violations.length > 0 ? 'gate_fail' : 'gate_pass',
            name: 'tasks',
            payload: { violations, checks: report.checks },
          })
          run.console.gateResult('tasks', report)
        }
        return [
          instance,
          { violations, unmatched: outcome.unmatched[instance] ?? [] },
        ] as const
      }),
    )
  }

export const noteUnverified =
  (run: TRun, stage: string) =>
  (instance: string, paths: readonly string[]): void => {
    if (paths.length === 0) return
    const id = rowFor(run)(instance)?.activity_run_id ?? ''
    const written = safeParseSettlement(() =>
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: id,
        type: 'log',
        name: WARNING_EVENT,
        payload: warningPayload({
          kind: 'unverified',
          activities: [instance],
          activityRunIds: [id],
          stage,
          paths,
          note: '',
        }),
      }),
    )
    if (written.status === 'error')
      run.console.note(
        `${instance}: could not record unmatched paths — ${written.error.message}`,
      )
  }
