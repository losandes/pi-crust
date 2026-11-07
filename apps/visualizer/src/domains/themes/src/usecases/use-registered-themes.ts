import { useEffect, useState } from 'react'
import { themesUrl } from '../io/fetch-registered-themes'
import {
  BUILTIN_THEMES,
  type TRegisteredTheme,
} from '../typedefs/registered-theme'

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
 *
 * Scoped to the workspace currently routed to, so the picker reflects the
 * trace on screen rather than whichever workspace the server happens to
 * watch first.
 */
export const useRegisteredThemes = (
  workspace?: string,
): readonly TRegisteredTheme[] => {
  const [themes, setThemes] =
    useState<readonly TRegisteredTheme[]>(BUILTIN_THEMES)

  useEffect(() => {
    const controller = new AbortController()
    fetch(themesUrl(workspace), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body) => {
        const parsed = body as
          | { themes?: readonly TRegisteredTheme[]; problem?: string }
          | undefined
        const found = parsed?.themes
        if (found !== undefined && found.length > 0) {
          setThemes(found)
        }
        if (parsed?.problem !== undefined && parsed.problem !== '') {
          // biome-ignore lint/suspicious/noConsole: 1.5.5 requires a console warning, deliberately — a broken theme registration must not surface in the UI, and a developer watching devtools is the intended audience
          console.warn(`theme registrations: ${parsed.problem}`)
        }
      })
      // A theme list that will not load is a styling fault, not a reason to
      // surface an error over a trace somebody is reading.
      .catch(() => undefined)

    return () => controller.abort()
  }, [workspace])

  return themes
}
