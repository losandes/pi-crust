import { Monitor, Moon, Sun, Contrast } from 'lucide-react'
import type { ComponentType } from 'react'
import { THEMES, THEME_LABELS, type TTheme } from '../theme/theme'
import { useTheme } from '../theme/use-theme'
import styles from './ThemeToggle.module.css'

const ICONS: Readonly<Record<TTheme, ComponentType<{ size?: number }>>> = {
  auto: Monitor,
  light: Sun,
  dark: Moon,
  'high-contrast': Contrast,
}

/**
 * Four buttons rather than a cycling toggle.
 *
 * A cycle hides where you are and makes "high contrast" three clicks from
 * "light" — which is the wrong cost to impose on the person most likely to
 * need it. These reach any theme in one press and say which one is on.
 *
 * They are toggle buttons rather than ARIA radios: a `role="radio"` on a
 * <button> promises arrow-key roving focus that this does not implement, and
 * a half-kept promise is worse for a screen reader than an honest button.
 */
export const ThemeToggle = () => {
  const [theme, choose] = useTheme()

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Theme</legend>
      {THEMES.map((option) => {
        const Icon = ICONS[option]
        const selected = option === theme
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            aria-label={THEME_LABELS[option]}
            title={THEME_LABELS[option]}
            className={selected ? `${styles.button} ${styles.on}` : styles.button}
            onClick={() => choose(option)}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </fieldset>
  )
}
