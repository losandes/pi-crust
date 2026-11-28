import {
  ARCHIVED_OPTIONS,
  FILTER_KEYS,
  STATUS_ORDER,
  type TFilterKey,
  type TFilters,
} from '../typedefs/filters'
import type { SessionSummary } from '../typedefs/session'

/** The value a session carries for a category, normalised to one string. */
// biome-ignore lint/suspicious/noShadowRestrictedNames: `valueOf` is this module's public name for the operation, fixed by the target signature this change is built against
export const valueOf = (
  session: Readonly<SessionSummary>,
  key: TFilterKey,
): string => {
  switch (key) {
    case 'repository':
      return session.repository_root ?? ''
    case 'workspace':
      return session.workspace ?? ''
    case 'lifecycle':
      return session.lifecycle ?? ''
    case 'status':
      return session.status ?? ''
    case 'branch':
      return session.branch ?? ''
    case 'archived':
      return session.archived ? 'archived' : 'active'
  }
}

/**
 * The distinct values a category can be filtered to, derived from the
 * sessions actually loaded — a tree with nothing in it has nothing to
 * filter to.
 *
 * Sorted rather than left in arrival order: the list re-derives on every
 * 500ms poll, and an option that moves under the pointer between mousedown
 * and click is a misclick.
 */
export const optionsFor = (
  sessions: readonly SessionSummary[],
  key: TFilterKey,
): readonly string[] => {
  if (key === 'archived') return ARCHIVED_OPTIONS

  const values = new Set(
    sessions
      .map((session) => valueOf(session, key))
      .filter((value) => value !== ''),
  )

  if (key === 'status') {
    return STATUS_ORDER.filter((status) => values.has(status))
  }

  return [...values].toSorted((left, right) => left.localeCompare(right))
}

/**
 * Whether a session is shown: for every category, either it is unconstrained
 * or the session's value is among the selected ones. A `null` or empty value
 * never matches a constrained category — it can still be shown while that
 * category is unconstrained.
 */
export const matchesFilters = (
  session: Readonly<SessionSummary>,
  filters: TFilters,
): boolean =>
  FILTER_KEYS.every((key) => {
    const selection = filters[key]
    if (selection.length === 0) return true
    const value = valueOf(session, key)
    return value !== '' && selection.includes(value)
  })

/** Add `value` to a category's selection, or remove it if already present. */
export const toggled = (
  filters: TFilters,
  key: TFilterKey,
  value: string,
): TFilters => {
  const selection = filters[key]
  const next = selection.includes(value)
    ? selection.filter((existing) => existing !== value)
    : [...selection, value]
  return { ...filters, [key]: next }
}

/** Select All — clears this category's constraint, leaving the rest alone. */
export const cleared = (filters: TFilters, key: TFilterKey): TFilters => ({
  ...filters,
  [key]: [],
})

export const locationsOf = (
  sessions: readonly SessionSummary[],
): ReadonlyMap<string, string> =>
  new Map(
    sessions.flatMap((session) =>
      session.repository_root && session.repository_location
        ? [[session.repository_root, session.repository_location] as const]
        : [],
    ),
  )

/** Case-insensitive substring match over option rows only. */
export const matchingOptions = (
  options: readonly string[],
  search: string,
): readonly string[] => {
  const needle = search.trim().toLowerCase()
  if (needle === '') return options
  return options.filter((option) => option.toLowerCase().includes(needle))
}

/** Whether the current selection needs rows the server hides by default. */
export const needsArchived = (filters: TFilters): boolean =>
  filters.archived.length === 0 || filters.archived.includes('archived')

/**
 * Whether a just-archived run should still be hidden optimistically.
 *
 * Keyed on the polled row's own `archived` column rather than held forever:
 * once the server confirms the write, the `archived` category governs
 * whether the row is shown, so a reader filtering to `archived` sees the run
 * they just archived instead of a row invisible until remount.
 */
export const isOptimisticallyHidden = (
  session: Readonly<SessionSummary>,
  justArchived: readonly string[],
): boolean => justArchived.includes(session.run_id) && !session.archived
