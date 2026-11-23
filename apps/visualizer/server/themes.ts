/** Machine registrations add to the built-in palettes; malformed entries never stop the viewer. */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'

export type TRegisteredTheme = Readonly<{
  name: string
  label: string
  builtin: boolean
  css: string
}>
export type TThemes = Readonly<{
  themes: readonly TRegisteredTheme[]
  problem: string
}>
export const BUILTIN_THEMES: readonly TRegisteredTheme[] = [
  { name: 'auto', label: 'Match the system', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
  { name: 'dracula', label: 'Dracula', builtin: true, css: '' },
  { name: 'high-contrast', label: 'High contrast', builtin: true, css: '' },
]
const table = (value: unknown): Readonly<Record<string, unknown>> => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value)
  return parsed.success ? parsed.data : {}
}
export const machineThemes = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): TThemes => {
  const directory = resolve(
    env.CRUST_MACHINE_CONFIG?.trim() ||
      join(env.HOME ?? homedir(), '.pi-crust', 'config'),
  )
  const file = join(directory, 'crust.config.toml')
  if (!existsSync(file)) return { themes: BUILTIN_THEMES, problem: '' }
  // biome-ignore lint/plugin/no-intermediate-try-catch: the configuration reader is the I/O boundary that reports unreadable or invalid TOML without stopping the viewer
  try {
    const document = Bun.TOML.parse(readFileSync(file, 'utf8'))
    const entries = Object.entries(table(document.themes)).map(
      ([name, value]) => {
        const entry = table(value)
        // biome-ignore lint/plugin/no-intermediate-try-catch: each unreadable registration is reported independently, preserving the other themes
        try {
          if (BUILTIN_THEMES.some((theme) => theme.name === name))
            return { problem: `${name}: built-in theme cannot be replaced` }
          if (
            typeof entry.stylesheet !== 'string' ||
            entry.stylesheet.trim() === ''
          )
            return { problem: `${name}: stylesheet is required` }
          const path = resolve(directory, entry.stylesheet)
          if (!path.startsWith(directory + sep))
            return { problem: `${name}: stylesheet is outside ${directory}` }
          if (!statSync(path).isFile())
            return { problem: `${name}: stylesheet is not a regular file` }
          return {
            theme: {
              name,
              label:
                typeof entry.label === 'string' && entry.label.trim() !== ''
                  ? entry.label
                  : name,
              builtin: false,
              css: readFileSync(path, 'utf8'),
            },
          }
        } catch (error) {
          return { problem: `${name}: ${String(error)}` }
        }
      },
    )
    return {
      themes: [
        ...BUILTIN_THEMES,
        ...entries.flatMap((entry) =>
          entry.theme === undefined ? [] : [entry.theme],
        ),
      ],
      problem: entries
        .flatMap((entry) =>
          entry.problem === undefined ? [] : [entry.problem],
        )
        .join('; '),
    }
  } catch (error) {
    return { themes: BUILTIN_THEMES, problem: `${file}: ${String(error)}` }
  }
}
