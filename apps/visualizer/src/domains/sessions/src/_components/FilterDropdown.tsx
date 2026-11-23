import { useEffect, useState } from 'react'
import { cx } from '@/lib/cx'
import { paletteColor } from '@/lib/palette'
import { matchingOptions } from '../usecases/filters'

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
    labelOf?: (option: string) => string
    colorOf?: (option: string) => string | undefined
    onOpen: (open: boolean) => void
    onToggle: (option: string) => void
    onSelectAll: () => void
  }>,
) => {
  const {
    label,
    options,
    selected,
    open,
    colorOf,
    labelOf,
    onOpen,
    onToggle,
    onSelectAll,
  } = props
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const visible = matchingOptions(options, search)
  const text = selected.length === 0 ? label : `${label} · ${selected.length}`

  return (
    <span className="inline-block @3xl/dashboard:relative">
      <button
        type="button"
        className={cx(
          // Issue #171 SC3: unchanged appearance; the removed rule supplied native control typography and checkbox margins.
          'leading-[normal] cursor-pointer rounded-full border-[length:var(--border-width)] px-2.5 py-0.5 font-mono text-[13px] focus-visible:shadow-[var(--ring)] focus-visible:outline-none',
          selected.length > 0
            ? 'border-current bg-panel-2 text-text'
            : 'border-border-soft bg-transparent text-dim',
        )}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => onOpen(!open)}
      >
        {text}
      </button>
      {open && (
        <div className="absolute inset-x-4 z-20 mt-1 flex max-h-70 min-w-50 flex-col gap-1 overflow-y-auto rounded-lg border-[length:var(--border-width)] border-border-soft bg-panel-2 p-2 shadow-(--shadow-panel) @3xl/dashboard:inset-x-auto @3xl/dashboard:top-full @3xl/dashboard:left-0">
          <input
            type="search"
            className="leading-[normal] min-w-0 rounded-md border-[length:var(--border-width)] border-border-soft bg-transparent px-2 py-1 font-mono text-[13px] text-text"
            aria-label={`search ${label}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-[13px]">
            <input
              type="checkbox"
              className="[font-family:revert] [font-size:revert] leading-[normal] [margin:revert]"
              checked={selected.length === 0}
              onChange={() => {
                if (selected.length > 0) onSelectAll()
              }}
            />
            Select All
          </label>
          {visible.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-[13px]"
            >
              <input
                type="checkbox"
                className="[font-family:revert] [font-size:revert] leading-[normal] [margin:revert]"
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
              />
              <span
                className="min-w-0 break-words"
                title={labelOf ? option : undefined}
                style={
                  colorOf
                    ? { color: paletteColor(colorOf(option) ?? 'blue') }
                    : undefined
                }
              >
                {labelOf ? labelOf(option) : option}
              </span>
            </label>
          ))}
        </div>
      )}
    </span>
  )
}
