/**
 * A theme as the observed repository registers it.
 *
 * Shared between the fetch and the stylesheet injection, and deliberately
 * free of React so that the injection can happen before the first paint.
 */

export type TRegisteredTheme = Readonly<{
  name: string
  label: string
  builtin: boolean
  /** CSS for a theme this repository defines. Empty for a builtin. */
  css: string
}>

/**
 * What the app ships with, and what the picker shows before the fetch lands.
 *
 * High contrast is not here any more: it is stamped into a repository as
 * `config/high-contrast.css` and registered in `crust.observe.yaml`, so that
 * the theme a team is most likely to adjust is one they can open. It arrives
 * through `/api/themes` like any other repository theme.
 */
export const BUILTIN_THEMES: readonly TRegisteredTheme[] = [
  { name: 'auto', label: 'Match the system', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
]
