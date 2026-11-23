import { resolve } from 'node:path'
import type { TActivityConfig, TTask } from '../../../../lib/contracts'
import { canonicalActivityName } from '../../../activities'
import { matchesPattern } from '../../../policy'
import type { TTaskContribution, TTaskPorts } from '../typedefs/task'

export const existingTaskPaths =
  ({ exists }: Pick<TTaskPorts, 'exists'>, root: string) =>
  (paths: readonly string[]): readonly string[] =>
    [...new Set(paths)].filter((path) => exists(resolve(root, path)))

export const selectTaskPaths = (
  activities: readonly TActivityConfig[],
  existing: (paths: readonly string[]) => readonly string[],
  task: TTask,
) => {
  const trigger = task.when.find(({ on }) => on === 'change')
  const skip = new Set(
    trigger?.skip.map((name) => canonicalActivityName(activities, name)),
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
