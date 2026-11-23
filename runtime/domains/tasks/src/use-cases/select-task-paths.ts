import { resolve } from 'node:path'
import type { TActivityConfig, TTask } from '../../../../lib/contracts'
import { canonicalActivityName } from '../../../activities'
import { matchesPattern } from '../../../policy'
import type {
  TTaskContribution,
  TTaskMoment,
  TTaskPorts,
} from '../typedefs/task'

export const existingTaskPaths =
  ({ exists }: Pick<TTaskPorts, 'exists'>, root: string) =>
  (paths: readonly string[]): readonly string[] =>
    [...new Set(paths)].filter((path) => exists(resolve(root, path)))

export const selectTaskPaths = (
  activities: readonly TActivityConfig[],
  existing: (paths: readonly string[]) => readonly string[],
  task: TTask,
  moment: TTaskMoment = { kind: 'change' },
) => {
  const trigger = task.when.find((entry) => {
    if ('on' in entry) return entry.on === moment.kind
    if (moment.kind !== 'before' && moment.kind !== 'after') return false
    const name =
      'before' in entry && moment.kind === 'before'
        ? entry.before
        : 'after' in entry && moment.kind === 'after'
          ? entry.after
          : undefined
    return (
      name !== undefined &&
      moment.stage.includes(canonicalActivityName(activities, name))
    )
  })
  const skip = new Set(
    trigger !== undefined && 'on' in trigger
      ? trigger.skip.map((name) => canonicalActivityName(activities, name))
      : [],
  )
  return ({ activity, paths }: TTaskContribution): readonly string[] =>
    trigger === undefined ||
    (activity !== undefined &&
      skip.has(canonicalActivityName(activities, activity)))
      ? []
      : existing(paths).filter(
          (path) =>
            task.match.length === 0 ||
            task.match.some((glob) => matchesPattern(path, glob)),
        )
}
