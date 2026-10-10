import { useEffect, useState } from 'react'
import { BUILTIN_THEMES, type TRegisteredTheme } from './registered'

/**
 * The themes the observed repository registers.
 *
 * Fetched rather than compiled in, because the list belongs to the repository
 * being watched and this app is pointed at a different one on every run. A
 * theme a team removed must leave the picker, which a built-in list cannot
 * express.
 *
 * The builtins are the starting value, not a fallback applied on failure:
 * the picker renders before the request settles, and showing nothing for a
 * frame is worse than showing what almost every repository registers anyway.
 */
export const useRegisteredThemes = (): readonly TRegisteredTheme[] => {
  const [themes, setThemes] =
    useState<readonly TRegisteredTheme[]>(BUILTIN_THEMES)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/themes', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body) => {
        const found = (body as { themes?: readonly TRegisteredTheme[] })?.themes
        if (found !== undefined && found.length > 0) {
          setThemes(found)
        }
      })
      // A theme list that will not load is a styling fault, not a reason to
      // surface an error over a trace somebody is reading.
      .catch(() => undefined)

    return () => controller.abort()
  }, [])

  return themes
}
