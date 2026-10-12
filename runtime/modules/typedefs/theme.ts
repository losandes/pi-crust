/**
 * Themes, as registrations rather than as built-ins.
 *
 * The `themes` list in `crust.observe.yaml` names every theme the visualizer
 * offers, including the ones that ship. Listing the defaults is what lets a
 * team remove one: delete the entry and it is gone from the picker. A file of
 * additions could only ever add to a fixed set, which is the shape this
 * refactor exists to undo.
 *
 * A theme is a name, a label, and where its styles come from. `builtin`
 * names a stylesheet in the pi-crust package; `stylesheet` names one in the
 * repository, which is how a team ships its own without the package knowing
 * anything about it.
 *
 * Nothing here parses CSS. A theme is a reference, and the trace UI's server
 * is what reads it — so a broken stylesheet is a visible styling fault rather
 * than a configuration error that stops a run.
 *
 * Plain CSS rather than SCSS: a theme is a block of channel triples under one
 * selector, and compiling would put a build activity between editing a file and
 * seeing the colour change.
 */

import { z } from 'zod'

export const DEFAULT_OBSERVE_PATH = '.pi-crust/config/crust.observe.yaml'

export const themeSchema = z
  .object({
    /** What `--theme` and the stored preference call it. */
    name: z.string(),
    /** What the picker shows. Defaults to the name when unset. */
    label: z.string().default(''),
    /** A stylesheet that ships with pi-crust. */
    builtin: z.boolean().default(false),
    /**
     * A stylesheet in this repository, relative to `.pi-crust/`.
     *
     * Ignored when `builtin` is true: a theme is one or the other, and a
     * theme claiming both would leave which one wins to load order.
     */
    stylesheet: z.string().default(''),
  })
  .transform((theme) => ({
    ...theme,
    label: theme.label === '' ? theme.name : theme.label,
  }))
export type TTheme = Readonly<z.infer<typeof themeSchema>>

/**
 * The theme half of `crust.observe.yaml`. The rest of that file — `db`,
 * `poll_ms`, `ports` — is ignored here rather than refused: it belongs to the
 * same file and to a different schema.
 */
export const themesFileSchema = z.object({
  /**
   * Which theme a repository starts on. `auto` follows the system.
   *
   * Spelled `default_theme` rather than `default`, because the file it now
   * lives in also carries a database path and two ports, and a bare
   * `default:` beside them says nothing about what it is the default of.
   */
  default_theme: z.string().default('auto'),
  themes: z.array(themeSchema).default([]),
})
export type TThemesFile = Readonly<z.infer<typeof themesFileSchema>>

/** What is wrong with a theme registration. */
export const themeFaults = (file: TThemesFile): readonly string[] => {
  const names = file.themes.map((theme) => theme.name)
  const duplicates = names.filter(
    (name, index) => names.indexOf(name) !== index,
  )
  const unsourced = file.themes
    .filter((theme) => !theme.builtin && theme.stylesheet === '')
    .map(
      (theme) =>
        `theme '${theme.name}' has no styles: set builtin, or name a ` +
        'stylesheet in this repository',
    )
  const missingDefault =
    file.default_theme === 'auto' || names.includes(file.default_theme)
      ? []
      : [
          `default theme '${file.default_theme}' is not registered — ` +
            `this repository offers ${names.join(', ')}`,
        ]

  return [
    ...[...new Set(duplicates)].map(
      (name) => `theme '${name}' is registered twice`,
    ),
    ...unsourced,
    ...missingDefault,
  ]
}

/** Themes the picker offers, in the order the file registers them. */
export const offerableThemes = (file: TThemesFile): readonly TTheme[] =>
  file.themes
