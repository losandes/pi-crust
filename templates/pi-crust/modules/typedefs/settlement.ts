/**
 * Settlement types — a DELIBERATE COPY, not an import.
 *
 * A settlement is a returned outcome rather than a thrown one, and the shape
 * is common enough that a repository adopting pi-crust may already define it
 * in a shared package of its own. `.pi-crust/` is stamped into repositories
 * that have no such package, and into some that do — so the one thing this
 * runtime cannot do is depend on either answer being true.
 *
 * Only the types and the one helper this runtime actually uses are defined.
 * The discriminant is `status: 'ok' | 'error'` and every field is
 * `Readonly<>`, which is the conventional shape: where a host repository
 * already uses it, a value crosses between the two without adaptation, and
 * where it does not, nothing here needs to change.
 */

/** The successful result of an operation. */
export type TSuccessResult<TData> = Readonly<{
  status: 'ok'
  data: TData
}>

/** The failed result of an operation. */
export type TErrorResult<TError = Error> = Readonly<{
  status: 'error'
  error: TError
}>

/** Either outcome of an operation that settles rather than throwing. */
export type TSettlement<TData, TError = Error> =
  | TSuccessResult<TData>
  | TErrorResult<TError>

/** Settle successfully. */
export const succeed = <TData>(data: TData): TSuccessResult<TData> => ({
  status: 'ok',
  data,
})

/** Settle with a failure. */
export const fail = <TError = Error>(error: TError): TErrorResult<TError> => ({
  status: 'error',
  error,
})

/** Narrow a settlement to its success branch. */
export const isOk = <TData, TError>(
  settlement: TSettlement<TData, TError>,
): settlement is TSuccessResult<TData> => settlement.status === 'ok'

/**
 * Wrap a throwing call once, at the edge, so the layers above it never catch.
 *
 * This is the only `try` in `modules/`, apart from the phase boundary in
 * `use-cases/run-phase.ts` which exists to turn a throw into a recorded
 * failure. Everything else settles.
 */
export const safeParseSettlement = <TData>(
  compute: () => TData,
): TSettlement<TData> => {
  try {
    return succeed(compute())
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)))
  }
}

/** The settled value, or a fallback. For calls whose failure carries no news. */
export const settledOr = <TData>(
  settlement: TSettlement<TData>,
  fallback: TData,
): TData => (settlement.status === 'ok' ? settlement.data : fallback)

/** The message of whatever a settlement failed with. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
