import { Contrast, Monitor, Moon, Palette, Sun } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect } from 'react'
import { applyCustomThemes } from '../theme/registered'
import { useRegisteredThemes } from '../theme/use-registered-themes'
import { useTheme } from '../theme/use-theme'
import styles from './ThemeToggle.module.css'

/**
 * Icons for the themes that ship. A theme a repository defines gets the
 * generic one: this app cannot know what a team's theme looks like, and
 * guessing from the name would be wrong exactly when the name is
 * interesting.
 */
const ICONS: Readonly<Record<string, ComponentType<{ size?: number }>>> = {
  auto: Monitor,
  light: Sun,
  dark: Moon,
  'high-contrast': Contrast,
}

/**
 * One button per registered theme, rather than a cycling toggle.
 *
 * A cycle hides where you are and makes "high contrast" three clicks from
 * "light" — the wrong cost to impose on the person most likely to need it.
 * These reach any theme in one press and say which one is on.
 *
 * They are toggle buttons rather than ARIA radios: a `role="radio"` on a
 * <button> promises arrow-key roving focus that this does not implement, and
 * a half-kept promise is worse for a screen reader than an honest button.
 *
 * The list comes from the observed repository, so a team that removed a
 * default has no button for it and one that added a theme has one.
 */
export const ThemeToggle = () => {
  const [theme, choose] = useTheme()
  const registered = useRegisteredThemes()

  // Styles go on the page before a button can select one, so choosing a
  // custom theme paints rather than setting an attribute nothing matches.
  useEffect(() => {
    applyCustomThemes(document, registered)
  }, [registered])

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      {registered.map((option) => {
        const Icon = ICONS[option.name] ?? Palette
        const selected = option.name === theme
        return (
          <button
            key={option.name}
            type="button"
            aria-pressed={selected}
            aria-label={option.label}
            title={option.label}
            className={
              selected ? `${styles.button} ${styles.on}` : styles.button
            }
            onClick={() => choose(option.name)}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </fieldset>
  )
}
