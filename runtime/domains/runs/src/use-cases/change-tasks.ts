import { mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import type { TActivity, TActivityRun, TRun } from '../../../../lib/contracts'
import {
  violationsOf,
  WARNING_EVENT,
  warningPayload,
} from '../../../../lib/contracts'
import { ensureDir, newId, nowIso } from '../../../../lib/system'
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

export const TASK_START_EVENT = 'task_start'
export const TASK_END_EVENT = 'task_end'

type TOpenExecution = Readonly<{
  task: string
  execution: string
  activityRunId: string
  startedAt: string
  remaining: number
  passed: boolean
}>

export const recordTaskCommands = (
  run: TRun,
  options: Readonly<{
    findRow: TTaskRowLookup
    moment?: 'deliver' | 'before' | 'after'
  }>,
): Pick<TChangeTasksParams, 'onCommandStart' | 'onCommandEnd'> => {
  // Command callbacks share this evaluation's open executions, replacing state.
  let open: readonly TOpenExecution[] = []
  const moment = options.moment ?? 'change'
  return {
    onCommandStart: ({ task, command, instances }) => {
      run.console.note(`task ${task}: ${command}`)
      if (open.some((one) => one.task === task)) return
      const commands = run.cfg.tasks[task]?.run
      const execution: TOpenExecution = {
        task,
        execution: newId(12),
        activityRunId:
          options.findRow(instances[0] ?? '')?.activity_run_id ?? '',
        startedAt: nowIso(),
        remaining:
          commands === undefined || typeof commands === 'string'
            ? 1
            : commands.length,
        passed: true,
      }
      open = [...open, execution]
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: execution.activityRunId,
        type: 'log',
        name: TASK_START_EVENT,
        payload: { task, execution: execution.execution, moment, instances },
        started_at: execution.startedAt,
      })
    },
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
      const execution = open.find((one) => one.task === task)
      if (execution === undefined) return
      const passed = execution.passed && result.passed
      if (execution.remaining > 1) {
        open = open.map((one) =>
          one === execution
            ? { ...one, remaining: one.remaining - 1, passed }
            : one,
        )
        return
      }
      run.tracer.event({
        run_id: run.runId,
        activity_run_id: execution.activityRunId,
        type: 'log',
        name: TASK_END_EVENT,
        payload: {
          task,
          execution: execution.execution,
          moment,
          instances,
          output_artifact: outputArtifact,
          passed,
        },
        started_at: execution.startedAt,
        ended_at: endedAt,
      })
      open = open.filter((one) => one !== execution)
    },
  }
}

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
