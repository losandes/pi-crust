import { existsSync } from 'node:fs'
import { runShellCommand } from './src/data/run-shell-command'
import { temporaryArtifactName, writeArtifact } from './src/data/write-artifact'
import type { TTaskPorts } from './src/typedefs/task'

export type {
  TChangeOutcome,
  TChangeTasksParams,
  TShellResult,
  TShellSpec,
  TTaskCommandEvent,
  TTaskCommandResult,
  TTaskCommandStart,
  TTaskContribution,
  TTaskMoment,
  TTaskPorts,
  TTaskResult,
  TTaskSkip,
  TTasksOutcome,
  TTasksParams,
} from './src/typedefs/task'
export {
  changeReport,
  NO_TASKS_DECLARED,
  taskResultNote,
} from './src/use-cases/change-report'
export { runChangeTasks, runTasks } from './src/use-cases/run-change-tasks'
export { taskArtifactName } from './src/use-cases/task-artifact-name'

export const liveTaskPorts: TTaskPorts = {
  exists: existsSync,
  runShell: runShellCommand(10_000),
  writeArtifact: writeArtifact(temporaryArtifactName),
}
