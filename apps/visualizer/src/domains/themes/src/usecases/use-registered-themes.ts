import { useEffect, useState } from 'react'
import { themesUrl } from '../io/fetch-registered-themes'
import {
  BUILTIN_THEMES,
  type TRegisteredTheme,
} from '../typedefs/registered-theme'

/** Load machine registrations once per mount; browser storage alone chooses the theme. */
export const useRegisteredThemes = (): readonly TRegisteredTheme[] => {
  const [themes, setThemes] =
    useState<readonly TRegisteredTheme[]>(BUILTIN_THEMES)

  useEffect(() => {
    const controller = new AbortController()
    fetch(themesUrl(), { signal: controller.signal })
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
  }, [])

  return themes
}
