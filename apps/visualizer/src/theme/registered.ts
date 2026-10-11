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

/** The id of the element custom theme styles are written into. */
export const CUSTOM_STYLE_ID = 'crust-custom-themes'

/**
 * Put every custom theme's CSS on the page, under one element.
 *
 * One element rather than one per theme: a theme is scoped by its own
 * `[data-theme='name']` selector, so they can share a stylesheet, and
 * replacing the whole block is the only update that cannot leave a removed
 * theme's rules behind.
 */
export const applyCustomThemes = (
  document: Pick<Document, 'getElementById' | 'createElement' | 'head'>,
  themes: readonly TRegisteredTheme[],
): string => {
  const css = themes
    .filter((theme) => !theme.builtin && theme.css !== '')
    .map((theme) => theme.css)
    .join('\n')
  const existing = document.getElementById(CUSTOM_STYLE_ID)
  const element = existing ?? document.createElement('style')
  // biome-ignore lint/plugin/no-object-mutation: this is the adapter the rule names — the DOM has no constructor that takes these, and an element is not a value to rebuild
  element.id = CUSTOM_STYLE_ID
  element.textContent = css
  if (existing === null) {
    document.head.appendChild(element)
  }

  return css
}
