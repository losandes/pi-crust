import type { ActivityRun } from '@/domains/activity-runs'
import { type EventRow, parsePayload } from '@/domains/events'
import { ts } from '@/lib/format'

export type TTaskBlock = Readonly<{
  /** A chart block built from task events, not a persisted Activity Run. */
  block: ActivityRun
  /** The Activity Run a click selects, when it is still in this trace. */
  selects: string | undefined
}>

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  change: 'repository task, run after a change',
  after: 'repository task, run after the stage',
  before: 'repository task, run before the stage',
  deliver: 'repository task, run before delivery',
}

export const taskBlocks = (
  events: readonly EventRow[],
  activityRuns: readonly ActivityRun[],
  running: boolean,
): readonly TTaskBlock[] => {
  const tasks = events
    .flatMap((event) => {
      if (
        event.type !== 'log' ||
        (event.name !== 'task_start' && event.name !== 'task_end') ||
        !Number.isFinite(ts(event.started_at))
      )
        return []
      const payload = parsePayload(event.payload_json)
      if (
        typeof payload?.task !== 'string' ||
        payload.task.length === 0 ||
        typeof payload.execution !== 'string' ||
        payload.execution.length === 0
      )
        return []
      return [
        {
          event,
          task: payload.task,
          execution: payload.execution,
          moment: payload.moment,
          passed: payload.passed,
        },
      ]
    })
    .toSorted((a, b) => a.event.rowid - b.event.rowid)

  const drawable = tasks.filter(({ event, execution }) =>
    event.name === 'task_end'
      ? Number.isFinite(ts(event.ended_at))
      : running &&
        !tasks.some(
          (other) =>
            (other.event.name === 'task_end' &&
              other.execution === execution) ||
            ts(other.event.started_at) > ts(event.started_at),
        ) &&
        !activityRuns.some((run) => ts(run.started_at) > ts(event.started_at)),
  )

  return drawable
    .filter(
      (task, index) =>
        drawable.findIndex((other) => other.execution === task.execution) ===
        index,
    )
    .map(
      ({ event, task, execution, moment, passed }): TTaskBlock => ({
        block: {
          activity_run_id: `task:${execution}`,
          run_id: event.run_id,
          seq: null,
          name: task,
          kind: 'code',
          owner: 'pi-crust',
          description:
            typeof moment === 'string' && Object.hasOwn(DESCRIPTIONS, moment)
              ? (DESCRIPTIONS[moment] ?? 'repository task')
              : 'repository task',
          status:
            event.name === 'task_end'
              ? passed === true
                ? 'success'
                : 'fail'
              : 'running',
          error: null,
          started_at: event.started_at,
          ended_at: event.name === 'task_end' ? event.ended_at : null,
        },
        selects: activityRuns.some(
          (run) => run.activity_run_id === event.activity_run_id,
        )
          ? (event.activity_run_id ?? undefined)
          : undefined,
      }),
    )
    .toSorted((a, b) => ts(a.block.started_at) - ts(b.block.started_at))
}
