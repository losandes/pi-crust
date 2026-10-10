/**
 * Choosing, applying, and remembering a theme — with no framework in it.
 *
 * This file is deliberately React-free. The theme has to be applied before the
 * first paint, which is before any component exists, so the mechanism cannot
 * live in a component. A hook wraps it; it does not own it.
 *
 * `auto` is a stored preference in its own right, not the absence of one.
 * "Follow my system" is a choice a person makes, and it must survive a reload
 * distinctly from "I picked dark and my system happens to agree".
 */

/**
 * The themes that ship. A repository may register others, and may remove
 * these — so this is what the app knows, never what it offers. The offered
 * list comes from `crust.themes.yaml` through `/api/themes`.
 */
export const THEMES = ['auto', 'light', 'dark', 'high-contrast'] as const

/**
 * A theme name, which is any string a repository registered.
 *
 * It was a union of the four that shipped. It cannot be: the set is open
 * now, and a union would make a team's own theme a type error at the only
 * places that handle it.
 */
export type TTheme = string

/** What a theme is actually called when written onto the document. */
export type TResolvedTheme = string

export const THEME_STORAGE_KEY = 'crust.theme'

/**
 * Anything non-empty is a theme name. Validation belongs with the registry,
 * which is the only thing that knows what a repository offers; a stored
 * preference for a theme that has since been removed simply finds no rules
 * and falls through to the base palette.
 */
export const isTheme = (value: unknown): value is TTheme =>
  typeof value === 'string' && value !== ''

/**
 * What the operating system is asking for.
 *
 * Contrast is matched before colour because it is the stronger signal: someone
 * who has turned on increased contrast is telling you something about
 * legibility, where a light/dark preference is mostly about taste.
 */
export const systemTheme = (
  matchMedia: (query: string) => { matches: boolean },
): TResolvedTheme => {
  if (matchMedia('(prefers-contrast: more)').matches) return 'high-contrast'
  if (matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  return 'dark'
}

/** The name that goes on the document, with `auto` resolved against the system. */
export const resolveTheme = (
  theme: TTheme,
  matchMedia: (query: string) => { matches: boolean },
): TResolvedTheme => (theme === 'auto' ? systemTheme(matchMedia) : theme)

/**
 * Read the stored preference, tolerating anything.
 *
 * Storage is shared with the rest of the origin and survives upgrades, so what
 * comes back may be stale, hand-edited, or from a version that spelled a theme
 * differently. An unrecognised value is not an error worth surfacing — it is a
 * preference we can no longer honour, and following the system is the right
 * answer to that.
 */
export const storedTheme = (storage: Pick<Storage, 'getItem'>): TTheme => {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY)
    return isTheme(raw) ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Put the theme on the document.
 *
 * `data-theme` always carries a resolved name, never `auto`, so CSS never has
 * to ask what the system prefers — the palettes stay a block of numbers each.
 * The chosen preference is kept alongside it in `data-theme-choice` so the UI
 * can show "Auto" as selected while rendering dark.
 */
export const applyTheme = (
  root: Pick<HTMLElement, 'setAttribute'>,
  theme: TTheme,
  matchMedia: (query: string) => { matches: boolean },
): TResolvedTheme => {
  const resolved = resolveTheme(theme, matchMedia)
  root.setAttribute('data-theme', resolved)
  root.setAttribute('data-theme-choice', theme)
  return resolved
}

export const saveTheme = (
  storage: Pick<Storage, 'setItem'>,
  theme: TTheme,
): void => {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // A private window with storage denied still gets a working theme for the
    // session. Refusing to apply it because it cannot be remembered would be
    // the worse failure.
  }
}

/**
 * The human-readable name, kept here so no component invents its own wording.
 */
export const THEME_LABELS: Readonly<Record<TTheme, string>> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
  'high-contrast': 'High contrast',
}
