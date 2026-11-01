import { useEffect, useState } from 'react'
import { matchingOptions } from '../lib/filters'
import { paletteColor } from '../lib/palette'
import styles from './FilterDropdown.module.css'

/**
 * One pill, one panel. Open-ness and selections live in the list that owns
 * every category; this component holds the search text and nothing else, so
 * it forgets it the moment the panel closes.
 */
export const FilterDropdown = (
  props: Readonly<{
    label: string
    options: readonly string[]
    /** Empty means Select All. */
    selected: readonly string[]
    open: boolean
    /** A per-option colour, for the tree category only. */
    colorOf?: (option: string) => string | undefined
    onOpen: (open: boolean) => void
    onToggle: (option: string) => void
    onSelectAll: () => void
  }>,
) => {
  const { label, options, selected, open, colorOf, onOpen, onToggle, onSelectAll } = props
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const visible = matchingOptions(options, search)
  const text = selected.length === 0 ? label : `${label} · ${selected.length}`

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={selected.length > 0 ? styles.onFilter : styles.filter}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => onOpen(!open)}
      >
        {text}
      </button>
      {open && (
        <div className={styles.panel}>
          <input
            type="search"
            className={styles.search}
            aria-label={`search ${label}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={selected.length === 0}
              onChange={() => {
                if (selected.length > 0) onSelectAll()
              }}
            />
            Select All
          </label>
          {visible.map((option) => (
            <label key={option} className={styles.option}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
              />
              <span style={colorOf ? { color: paletteColor(colorOf(option) ?? 'blue') } : undefined}>
                {option}
              </span>
            </label>
          ))}
        </div>
      )}
    </span>
  )
}
