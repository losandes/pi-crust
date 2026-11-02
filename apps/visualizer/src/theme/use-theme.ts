import { useCallback, useEffect, useState } from 'react'
import { applyTheme, saveTheme, storedTheme, type TTheme } from './theme'

/**
 * The React face of the theme. The mechanism lives in `theme.ts`, which runs
 * before any component exists; this only remembers what was chosen and asks
 * the document to change.
 */
export const useTheme = (): readonly [TTheme, (next: TTheme) => void] => {
  const [theme, setTheme] = useState<TTheme>(() =>
    storedTheme(window.localStorage),
  )

  const choose = useCallback((next: TTheme) => {
    setTheme(next)
    saveTheme(window.localStorage, next)
    applyTheme(document.documentElement, next, window.matchMedia)
  }, [])

  /**
   * Following the system means following it as it changes, not only at boot —
   * a laptop that switches to dark at sunset should take the app with it.
   */
  useEffect(() => {
    if (theme !== 'auto') return undefined
    const queries = [
      window.matchMedia('(prefers-color-scheme: light)'),
      window.matchMedia('(prefers-contrast: more)'),
    ]
    const onChange = () =>
      applyTheme(document.documentElement, 'auto', window.matchMedia)
    for (const query of queries) query.addEventListener('change', onChange)
    return () => {
      for (const query of queries) query.removeEventListener('change', onChange)
    }
  }, [theme])

  return [theme, choose] as const
}
