import { TASK_VARIABLE } from '../../../../lib/contracts'

const quoteWord = (value: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`

export const renderTaskCommand = (
  paths: readonly string[],
  baseRef: string,
) => {
  const changedPaths = paths.map(quoteWord).join(' ')
  const base = quoteWord(baseRef)
  return (command: string): string =>
    command.replace(TASK_VARIABLE, (_, name) =>
      name === 'changed_paths' ? changedPaths : base,
    )
}
