/**
 * Prompt rendering: load system/user refs from config, replace {{placeholders}}.
 */

import { join } from 'node:path'
import { ensureDir, readText, writeText } from './files'

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
