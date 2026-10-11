/**
 * The themes a workspace registers, read from its stamp.
 *
 * The `themes` list in `crust.observe.yaml` names every theme the picker
 * offers, including the ones that ship — which is what lets a team remove one. The server reads it
 * because the file belongs to the repository being observed, not to this app,
 * and the app is pointed at a different repository on every run.
 *
 * A custom theme's styles are returned as text, not as a path. The browser
 * cannot read the observed repository's filesystem, and serving the file
 * separately would mean a second round trip and a path-traversal surface for
 * no benefit: a theme is a short block of custom properties.
 *
 * Plain CSS, not SCSS. Nesting and variables buy nothing when a theme is a
 * list of channel triples, and compiling would put a build step between a
 * developer editing a file and seeing the colour change.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type TRegisteredTheme = Readonly<{
  name: string
  label: string
  builtin: boolean
  /** CSS for a theme this repository defines. Empty for a builtin. */
  css: string
}>

export type TWorkspaceThemes = Readonly<{
  /** The theme a workspace starts on. */
  default: string
  themes: readonly TRegisteredTheme[]
  /** Why the registrations could not be read, when they could not be. */
  problem: string
}>

/** What the app falls back to: exactly what it shipped with. */
export const BUILTIN_THEMES: readonly TRegisteredTheme[] = [
  { name: 'auto', label: 'Match the system', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
]

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

/**
 * A stylesheet a registration names, read from inside the stamp.
 *
 * Resolved and then checked to still be inside `.pi-crust/`, because the
 * value comes from a file in the observed repository and `../../../etc` is a
 * valid-looking string. A theme that escapes the directory is dropped rather
 * than reported: it is a configuration mistake, and a styling fault should
 * not take out the page that would show it.
 */
const readStylesheet = (stampDir: string, reference: string): string => {
  if (reference === '') {
    return ''
  }
  const full = resolve(join(stampDir, reference))
  if (!full.startsWith(resolve(stampDir))) {
    return ''
  }

  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

const toTheme = (
  stampDir: string,
  entry: Record<string, unknown>,
): TRegisteredTheme => {
  const name = asString(entry.name)

  return {
    name,
    label: asString(entry.label) === '' ? name : asString(entry.label),
    builtin: entry.builtin === true,
    css:
      entry.builtin === true
        ? ''
        : readStylesheet(stampDir, asString(entry.stylesheet)),
  }
}

/**
 * Read a workspace's registrations, falling back to what shipped.
 *
 * A workspace with no themes file is the normal case for an older stamp, and
 * it gets the builtins rather than an empty picker. A file that cannot be
 * parsed also gets the builtins, with the reason attached — a broken theme
 * registration must not be able to stop somebody reading a trace.
 */
export const workspaceThemes = (workspaceRoot: string): TWorkspaceThemes => {
  const stampDir = join(workspaceRoot, '.pi-crust')
  const path = join(stampDir, 'config', 'crust.observe.yaml')
  if (!existsSync(path)) {
    return { default: 'auto', themes: BUILTIN_THEMES, problem: '' }
  }
  // biome-ignore lint/plugin/no-intermediate-try-catch: this is the boundary the rule names — the file belongs to the observed repository and may be anything, and a broken registration must not stop a trace being read
  try {
    const parsed = asRecord(Bun.YAML.parse(readFileSync(path, 'utf8')))
    const entries = Array.isArray(parsed.themes) ? parsed.themes : []
    const themes = entries
      .map((entry) => toTheme(stampDir, asRecord(entry)))
      .filter((theme) => theme.name !== '')

    return {
      default: asString(parsed.default_theme, 'auto'),
      themes: themes.length === 0 ? BUILTIN_THEMES : themes,
      problem: '',
    }
  } catch (error) {
    return {
      default: 'auto',
      themes: BUILTIN_THEMES,
      problem: `${path}: ${String(error)}`,
    }
  }
}
