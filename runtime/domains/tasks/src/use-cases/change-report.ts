import type { TGateReport } from '../../../../lib/contracts'
import type { TChangeOutcome, TTaskResult } from '../typedefs/task'

export const NO_TASKS_DECLARED =
  'no tasks are declared: `tasks` in crust.config.yaml is empty, so no command ran. Declare a task there to have changes verified.'

export const taskResultNote = ({ passed, commands }: TTaskResult): string =>
  passed
    ? `${commands.length} command(s) exited 0`
    : commands
        .filter((result) => !result.passed)
        .map((result) => {
          const detail = result.timedOut
            ? `timed out after ${result.timeoutSeconds}s`
            : `exited ${result.returncode}`
          return `\`${result.command}\` ${detail}\n${result.outputTail}`.trimEnd()
        })
        .join('\n')

export const changeReport = (
  outcome: TChangeOutcome,
  instance: string,
): TGateReport | undefined => {
  const existing = outcome.existing[instance] ?? 0
  const checks = outcome.results
    .filter((result) => (result.selected[instance]?.length ?? 0) > 0)
    .map((result) => ({
      item: `task ${result.name}`,
      ok: result.passed,
      note: taskResultNote(result),
    }))
  if (existing === 0 && checks.length === 0) return undefined
  return {
    checks:
      checks.length > 0
        ? checks
        : [
            {
              item: 'tasks',
              ok: true,
              note:
                outcome.declared === 0
                  ? NO_TASKS_DECLARED
                  : `no task ran over ${existing} changed path(s)`,
            },
          ],
  }
}
