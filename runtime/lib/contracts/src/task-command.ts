export const TASK_VARIABLE = /\{\{\s*(changed_paths|base_ref)\s*\}\}/g

export const hasQuotedTaskVariable = (command: string): boolean => {
  // Quote and escape state depend on the preceding character.
  let quote: '"' | "'" | undefined
  let escaped = false
  const variables = new Set(
    Array.from(command.matchAll(TASK_VARIABLE), (match) => match.index),
  )
  for (let index = 0; index < command.length; index += 1) {
    if (quote !== undefined && variables.has(index)) return true
    const character = command[index]
    if (escaped) escaped = false
    else if (character === '\\' && quote !== "'") escaped = true
    else if (character === quote) quote = undefined
    else if (quote === undefined && (character === '"' || character === "'"))
      quote = character
  }
  return false
}
