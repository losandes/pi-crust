import { isAbsolute, join, posix } from 'node:path'
import { errorMessage, safeParseSettlement } from '../../../../../lib/typedefs'
import type { TTask } from '../../../../lib/contracts'
import { operatorEnv } from '../../../../lib/system'
import type {
  TChangeOutcome,
  TChangeTasksParams,
  TShellResult,
  TTaskCommandResult,
  TTaskPorts,
  TTaskResult,
} from '../typedefs/task'
import { renderTaskCommand } from './render-task-command'
import { existingTaskPaths, selectTaskPaths } from './select-task-paths'

const artifactSection = (command: string, result: TShellResult): string =>
  `$ ${command}\nexit: ${result.returncode}\nduration_seconds: ${result.durationSeconds.toFixed(3)}\n\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`

type TTaskSelection = Readonly<{
  name: string
  task: TTask
  outputArtifact: string
  selected: TTaskResult['selected']
  instances: readonly string[]
}>

const executeTask =
  (ports: TTaskPorts, params: TChangeTasksParams) =>
  async ({
    name,
    task,
    outputArtifact,
    selected,
    instances,
  }: TTaskSelection): Promise<TTaskResult> => {
    const timeoutSeconds =
      task.timeout_seconds ?? params.cfg.task_config.timeout_seconds
    const paths = [...new Set(Object.values(selected).flat())]
      .toSorted()
      .map((path) =>
        task.cwd === '' || isAbsolute(path)
          ? path
          : posix.relative(task.cwd, path),
      )
    const render = renderTaskCommand(paths, params.baseRef)
    const commands = typeof task.run === 'string' ? [task.run] : task.run
    const cwd = join(params.root, task.cwd)
    const env = operatorEnv()
    const finished = await commands.reduce<
      Promise<
        Readonly<{ commands: readonly TTaskCommandResult[]; text: string }>
      >
    >(
      async (prior, template) => {
        const previous = await prior
        const command = render(template)
        const startedAt = new Date().toISOString()
        params.onCommandStart({ task: name, command, instances })
        const shell = await ports.runShell({
          command,
          cwd,
          timeoutSeconds,
          env,
        })
        const endedAt = new Date().toISOString()
        const result: TTaskCommandResult = {
          command,
          returncode: shell.returncode,
          passed: shell.returncode === 0,
          timedOut: shell.timedOut,
          timeoutSeconds,
          durationSeconds: shell.durationSeconds,
          outputTail: `${shell.stdout}${shell.stderr}`.slice(-4000),
        }
        const text = previous.text + artifactSection(command, shell)
        const written = safeParseSettlement(() =>
          ports.writeArtifact(outputArtifact, text),
        )
        if (written.status === 'error') {
          throw new Error(
            `task ${name}: cannot write ${outputArtifact}: ${errorMessage(written.error)}`,
          )
        }
        params.onCommandEnd({
          task: name,
          result,
          outputArtifact,
          instances,
          startedAt,
          endedAt,
        })
        return { commands: [...previous.commands, result], text }
      },
      Promise.resolve({ commands: [], text: '' }),
    )
    return {
      name,
      selected,
      commands: finished.commands,
      passed: finished.commands.every(({ passed }) => passed),
      outputArtifact,
    }
  }

export const runChangeTasks =
  (ports: TTaskPorts) =>
  async (params: TChangeTasksParams): Promise<TChangeOutcome> => {
    const { cfg, root, contributions } = params
    const tasks = Object.entries(cfg.tasks)
    const existingPaths = existingTaskPaths(ports, root)
    const initial = contributions.map(
      ({ instance, paths }) => [instance, existingPaths(paths)] as const,
    )
    const execute = executeTask(ports, params)
    const results = await tasks.reduce<Promise<readonly TTaskResult[]>>(
      async (prior, [name, task], index) => {
        const previous = await prior
        const select = selectTaskPaths(cfg.activities, existingPaths, task)
        const selections = contributions.map(
          (contribution) =>
            [contribution.instance, select(contribution)] as const,
        )
        const instances = selections
          .filter(([, paths]) => paths.length > 0)
          .map(([instance]) => instance)
        if (instances.length === 0) return previous
        const outputArtifact = params.artifactFor({ name, index: index + 1 })
        return [
          ...previous,
          await execute({
            name,
            task,
            outputArtifact,
            selected: Object.fromEntries(selections),
            instances,
          }),
        ]
      },
      Promise.resolve([]),
    )
    return {
      declared: tasks.length,
      results,
      existing: Object.fromEntries(
        initial.map(([name, paths]) => [name, paths.length]),
      ),
      unmatched: Object.fromEntries(
        initial.map(([name, paths]) => [
          name,
          paths.filter(
            (path) =>
              !results.some((result) => result.selected[name]?.includes(path)),
          ),
        ]),
      ),
    }
  }
