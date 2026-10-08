/**
 * The one clock in the system. Every timestamp pi-crust writes comes from here.
 *
 * FORMAT IS A SCHEMA DECISION, NOT A FORMATTING ONE. These are TEXT columns and
 * `sessions` is read with `ORDER BY started_at DESC`, which is a lexicographic
 * comparison — so a database holding two timestamp spellings sorts wrongly, and
 * only for the rows that straddle the change. That failure reads as a UI glitch
 * rather than a bug.
 *
 * pi-crust writes the `Z` form (`2025-01-01T12:00:00.000Z`), which is what
 * `toISOString()` gives and what every consumer here accepts. The Python factory
 * this was ported from emits the offset form (`+00:00`); the two never share a
 * database, so the difference is safe — but it is deliberate, and anyone
 * comparing the two traces side by side should know that.
 */

export const nowIso = (): string => new Date().toISOString()

/** Monotonic milliseconds, for durations. Never for a stored timestamp. */
export const monotonicMs = (): number => performance.now()
