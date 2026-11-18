import { Contrast, Monitor, Moon, Palette, Sun } from 'lucide-react'
import type { ComponentType, KeyboardEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { listboxKey } from '@/lib/listbox'
import { THEME_LABELS } from '../state/theme-store'
import { applyCustomThemes } from '../usecases/apply-custom-themes'
import { useRegisteredThemes } from '../usecases/use-registered-themes'
import { useTheme } from '../usecases/use-theme'

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
 * A listbox, not a native `<select>` and not one button per theme.
 *
 * The request shows an icon on the closed control and an icon beside each
 * name when open — no browser renders either inside a `<select>`, so the
 * markup has to be built. It is `listbox`/`option`, not `menu`/`menuitem`:
 * this picks one value from a set, it does not run commands. And it is not
 * a cycling toggle: a cycle hides where you are and makes "high contrast"
 * several clicks from "light", the wrong cost for the person most likely to
 * need it.
 *
 * The list comes from the observed repository, so a team that removed a
 * default has no row for it and one that added a theme has one.
 */
export const ThemePicker = (props: Readonly<{ workspace?: string }> = {}) => {
  const { workspace } = props
  const [theme, choose] = useTheme()
  const registered = useRegisteredThemes(workspace)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Styles go on the page before a row can select one, so choosing a custom
  // theme paints rather than setting an attribute nothing matches.
  useEffect(() => {
    applyCustomThemes(document, registered)
  }, [registered])

  // Focus follows `active` while the list is open; nothing else calls
  // `.focus()` on a row.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    )
    row?.focus()
  }, [open, active])

  const currentLabel =
    registered.find((option) => option.name === theme)?.label ??
    THEME_LABELS[theme] ??
    theme
  const CurrentIcon = ICONS[theme] ?? Palette

  const openAt = (index: number) => {
    setActive(index)
    setOpen(true)
  }

  const openAtCurrent = () => {
    const index = registered.findIndex((option) => option.name === theme)
    openAt(index === -1 ? 0 : index)
  }

  const close = () => {
    setOpen(false)
  }

  const closeAndReturnFocus = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const select = (index: number) => {
    const option = registered[index]
    if (option !== undefined) choose(option.name)
    closeAndReturnFocus()
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openAtCurrent()
    }
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = listboxKey(event.key, active, registered.length)
    if (action.kind === 'none') return
    event.preventDefault()
    if (action.kind === 'move') setActive(action.index)
    else if (action.kind === 'select') select(action.index)
    else closeAndReturnFocus()
  }

  // A pointerdown outside the control, or focus leaving it (what Tab
  // produces), closes it without changing the selection. Both are native
  // DOM listeners rather than JSX handlers: the wrapping `<div>` has no
  // interactive role of its own — only its children (the trigger, the
  // rows) do — so the lint that polices interaction handlers on static
  // elements does not apply to a listener attached this way. `setOpen` is
  // the `useState` setter, so it is stable and does not need to be listed
  // as a dependency.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target !== null && wrapperRef.current?.contains(target)) return
      setOpen(false)
    }
    const onFocusOut = (event: globalThis.FocusEvent) => {
      const next = event.relatedTarget as Node | null
      if (next !== null && wrapperRef.current?.contains(next)) return
      setOpen(false)
    }
    const wrapper = wrapperRef.current
    document.addEventListener('pointerdown', onPointerDown)
    wrapper?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      wrapper?.removeEventListener('focusout', onFocusOut)
    }
  }, [open])

  return (
    <div className="relative inline-flex" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Theme: ${currentLabel}`}
        title={`Theme: ${currentLabel}`}
        // Issue #171 SC3: unchanged appearance; the removed rule supplied native control typography.
        className="[font-family:revert] [font-size:revert] leading-[normal] inline-flex h-7 w-8 cursor-pointer items-center justify-center rounded-lg border-[length:var(--border-width)] border-border-soft bg-panel-2/60 p-0 text-faint hover:bg-accent/[calc(var(--fill-soft)*100%)] hover:text-text focus-visible:shadow-(--ring) focus-visible:outline-none"
        onClick={() => (open ? close() : openAtCurrent())}
        onKeyDown={onTriggerKeyDown}
      >
        <CurrentIcon size={16} />
      </button>
      {open && (
        // A `div`, not a `ul`: this is a widget with its own interaction
        // model (1.2.5–1.2.9), not a list of static content, which is what
        // the `listbox`/`option` roles are for.
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Theme"
          className="absolute top-full right-0 z-20 m-0 mt-1.5 max-h-80 min-w-44 list-none overflow-y-auto rounded-lg border-[length:var(--border-width)] border-border-soft bg-panel-2 p-1 shadow-(--shadow-panel)"
          onKeyDown={onListKeyDown}
        >
          {registered.map((option, index) => {
            const Icon = ICONS[option.name] ?? Palette
            const selected = option.name === theme
            return (
              <div
                key={option.name}
                role="option"
                tabIndex={-1}
                data-index={index}
                aria-selected={selected}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/[calc(var(--fill-soft)*100%)] hover:text-text focus-visible:shadow-(--ring) focus-visible:outline-none',
                  selected
                    ? 'bg-accent/[calc(var(--fill-medium)*100%)] text-accent'
                    : 'text-faint',
                )}
                onClick={() => select(index)}
                onKeyDown={onListKeyDown}
              >
                <Icon size={16} />
                <span>{option.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
