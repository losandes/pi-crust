/**
 * The dashboard's filter model, kept free of React so it can be tested and
 * reasoned about on its own — components hold state and markup only.
 *
 * Every category's selection is a list of strings, and an empty list is
 * `Select All`: it constrains nothing. A separate boolean or sentinel for
 * "all" would be a second encoding of the same state, which then has to be
 * kept in sync in storage, in matching, and in the pill's on/off class.
 */

import type { SessionSummary } from './types'

export type TFilterKey =
  | 'workspace'
  | 'lifecycle'
  | 'status'
  | 'branch'
  | 'archived'

/** Pill order, left to right. */
export const FILTER_KEYS: readonly TFilterKey[] = [
  'workspace',
  'lifecycle',
  'status',
  'branch',
  'archived',
]

export const FILTER_LABELS: Readonly<Record<TFilterKey, string>> = {
  workspace: 'tree',
  lifecycle: 'lifecycle',
  status: 'status',
  branch: 'branch',
  archived: 'state',
}

/** An empty list is Select All: the category constrains nothing. */
export type TFilters = Readonly<Record<TFilterKey, readonly string[]>>

export const DEFAULT_FILTERS: TFilters = {
  workspace: [],
  lifecycle: [],
  status: [],
  branch: [],
  archived: ['active'],
}

export const FILTER_STORAGE_KEY = 'crust.filters'
export const ARCHIVED_OPTIONS: readonly string[] = ['active', 'archived']
export const STATUS_ORDER: readonly string[] = [
  'running',
  'waiting',
  'success',
  'fail',
]

/** The value a session carries for a category, normalised to one string. */
// biome-ignore lint/suspicious/noShadowRestrictedNames: `valueOf` is this module's public name for the operation, fixed by the target signature this change is built against
export const valueOf = (session: SessionSummary, key: TFilterKey): string => {
  switch (key) {
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
  session: SessionSummary,
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
  session: SessionSummary,
  justArchived: readonly string[],
): boolean => justArchived.includes(session.run_id) && !session.archived

type TStorageReader = Pick<Storage, 'getItem'>
type TStorageWriter = Pick<Storage, 'setItem'>

/**
 * Reads the stored filters, tolerating absent, unparseable, or partial
 * payloads. A malformed object falls back to the defaults wholesale; an
 * individual key that is missing or not an array falls back to just that
 * key's default. A present array keeps only its string entries, even if
 * that empties it, rather than failing the whole key. Unknown keys are
 * ignored.
 */
export const readFilters = (storage: TStorageReader): TFilters => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, converting a throwing or malformed Storage into the settlement every caller already reads
  try {
    const raw = storage.getItem(FILTER_STORAGE_KEY)
    if (raw === null) return DEFAULT_FILTERS

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FILTERS

    const record = parsed as Readonly<Record<string, unknown>>
    const entries = FILTER_KEYS.map((key) => {
      const value = record[key]
      if (!Array.isArray(value)) return [key, DEFAULT_FILTERS[key]] as const
      const strings = value.filter(
        (entry): entry is string => typeof entry === 'string',
      )
      return [key, strings] as const
    })
    return Object.fromEntries(entries) as TFilters
  } catch {
    return DEFAULT_FILTERS
  }
}

export const saveFilters = (
  storage: TStorageWriter,
  filters: TFilters,
): void => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, swallowing a throwing Storage exactly as src/lib/token.ts already does
  try {
    storage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // A private window or a full quota still gets a working session; it just
    // asks for the filters again next time, which is better than a broken
    // page.
  }
}
