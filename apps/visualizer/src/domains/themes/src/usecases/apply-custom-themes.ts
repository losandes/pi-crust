import type { TRegisteredTheme } from '../typedefs/registered-theme'

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
