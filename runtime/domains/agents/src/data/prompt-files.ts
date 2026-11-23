/** Read resolved prompt paths and substitute the variables supplied by the caller. */
import { join } from 'node:path'
import { ensureDir, isFile, readText, writeText } from '../../../../lib/system'

export const promptFile = (
  directory: string,
  kind: 'system' | 'user' | 'revise',
): string => join(directory, `${kind}.md`)

export const revisePromptPath = (directory: string): string => {
  const revise = promptFile(directory, 'revise')
  return isFile(revise) ? revise : promptFile(directory, 'user')
}

export const render = (
  templatePath: string,
  variables: Readonly<Record<string, string>>,
): string =>
  Object.entries(variables).reduce(
    (text, [key, value]) => text.split(`{{${key}}}`).join(value),
    readText(templatePath),
  )

/** Save the exact prompt sent, before execution — the audit copy. */
export const savePrompt = (
  directory: string,
  name: string,
  content: string,
): string => {
  ensureDir(directory)
  return writeText(join(directory, name), content)
}
