import type { SQLInputValue } from 'node:sqlite'

export type TSqlParam = SQLInputValue | boolean | undefined
export type TSqlParams = readonly TSqlParam[]
export type TStatement<TRow, TParams extends TSqlParams> = Readonly<{
  all: (...params: TParams) => TRow[]
  get: (...params: TParams) => TRow | undefined
  values: (...params: TParams) => unknown[][]
  run: (...params: TParams) => void
}>
export type TDatabase = Readonly<{
  query: <TRow = unknown, TParams extends TSqlParams = TSqlParams>(
    sql: string,
  ) => TStatement<TRow, TParams>
  run: (sql: string, params?: TSqlParams) => void
  exec: (sql: string) => void
  transaction: <TResult>(work: () => TResult) => TResult
  close: () => void
}>
export { openDatabase } from './src/open-database'
