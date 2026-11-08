import {
  DEFAULT_FILTERS,
  FILTER_KEYS,
  type TFilters,
} from '../typedefs/filters'

export const FILTER_STORAGE_KEY = 'crust.filters'

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
  // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, swallowing a throwing Storage exactly as lib/api-client/src/token-store.ts already does
  try {
    storage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // A private window or a full quota still gets a working session; it just
    // asks for the filters again next time, which is better than a broken
    // page.
  }
}
