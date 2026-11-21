/**
 * Prompt rendering: resolve a reference, replace {{placeholders}}.
 *
 * A reference is resolved against the repository first and the pi-crust
 * package second. That is the whole override mechanism: a team that wants a
 * different planner prompt writes `.pi-crust/prompts/plan/
 * system.md`, and nothing else changes — no registry, no flag, no config
 * edit. Absent that file, the prompt that ships is the one used, so an
 * improvement to a shipped prompt reaches every repository that did not
 * deliberately replace it.
 *
 * An absolute path is taken as given. A developer who writes one has said
 * exactly where they mean.
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TPrompts } from '../../../../lib/contracts'
import { ensureDir, isFile, readText, writeText } from '../../../../lib/system'

/** The runtime directory inside the pi-crust package. */
const packageRoot = (): string =>
  dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))

/**
 * Where a prompt reference actually points.
 *
 * Prompt references resolve against the repository's `.pi-crust/` first,
 * falling back to the prompt that ships with the package.
 *
 * Exported because validation has to report the path it could not find, and
 * reporting the reference rather than the resolved path sends a developer
 * looking in the wrong place.
 */
export const resolveReference = (reference: string): string => {
  if (isAbsolute(reference)) {
    return reference
  }
  const inRepository = join(process.cwd(), '.pi-crust', reference)

  return existsSync(inRepository)
    ? inRepository
    : join(packageRoot(), reference)
}

/** The prompt-shaped name for the same resolution. */
export const resolvePromptPath = resolveReference

export const revisePromptReference = (prompts: TPrompts): string => {
  if (prompts.revise !== undefined) return prompts.revise
  const besideUser = join(dirname(prompts.user), 'revise.md')
  return isFile(resolveReference(besideUser)) ? besideUser : prompts.user
}

export const render = (
  templatePath: string,
  variables: Readonly<Record<string, string>>,
): string =>
  Object.entries(variables).reduce(
    (text, [key, value]) => text.split(`{{${key}}}`).join(value),
    readText(resolveReference(templatePath)),
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
