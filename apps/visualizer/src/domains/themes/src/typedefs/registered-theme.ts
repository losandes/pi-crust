/**
 * A theme as the observed machine registers it.
 *
 * Shared between the fetch and the stylesheet injection, and deliberately
 * free of React so that the injection can happen before the first paint.
 */

export type TRegisteredTheme = Readonly<{
  name: string
  label: string
  builtin: boolean
  /** CSS for a theme this machine defines. Empty for a builtin. */
  css: string
}>

/**
 * What the app ships with, and what the picker shows before the fetch lands.
 *
 * All five choices are built in, with palettes in `tokens.css`, including
 * Dracula and high contrast. Machine `[themes.<name>]` entries only add to
 * this list.
 */
export const BUILTIN_THEMES: readonly TRegisteredTheme[] = [
  { name: 'auto', label: 'Match the system', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
  { name: 'dracula', label: 'Dracula', builtin: true, css: '' },
  { name: 'high-contrast', label: 'High contrast', builtin: true, css: '' },
]
