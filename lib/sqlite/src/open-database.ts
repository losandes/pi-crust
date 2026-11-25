import type { SQLInputValue } from 'node:sqlite'
import { safeParseSettlement } from '../../typedefs'
import type { TDatabase, TSqlParam, TSqlParams } from '../index'

type TEmitter = Readonly<
  Pick<NodeJS.Process, 'emitWarning' | 'getBuiltinModule'>
>

/** Loading the builtin is the boundary owning its experimental diagnostic. */
export const loadSqlite = (
  emitter: TEmitter = process,
): typeof import('node:sqlite') => {
  const original = emitter.emitWarning
  const filtered = ((warning: string | Error, ...args: unknown[]) => {
    const type =
      typeof args[0] === 'string'
        ? args[0]
        : (args[0] as { type?: string } | undefined)?.type
    if (type === 'ExperimentalWarning' && String(warning).includes('SQLite'))
      return
    Reflect.apply(original, emitter, [warning, ...args])
  }) as typeof original
  // This boundary borrows the host warning channel synchronously, restoring it below.
  // biome-ignore lint/plugin/no-object-mutation: the process boundary must intercept the host warning channel and restore it synchronously
  Reflect.set(emitter, 'emitWarning', filtered)
  try {
    return emitter.getBuiltinModule(
      'node:sqlite',
    ) as typeof import('node:sqlite')
  } finally {
    // biome-ignore lint/plugin/no-object-mutation: restore the host warning channel owned temporarily by this boundary
    Reflect.set(emitter, 'emitWarning', original)
  }
}

const binding = (value: TSqlParam): SQLInputValue =>
  value === undefined
    ? null
    : typeof value === 'boolean'
      ? Number(value)
      : value
const bindings = (params: TSqlParams): SQLInputValue[] => params.map(binding)

export const openDatabase = (
  path: string,
  options: Readonly<{ readonly?: boolean }> = {},
): TDatabase => {
  const { DatabaseSync } = loadSqlite()
  const db = new DatabaseSync(path, {
    readOnly: options.readonly ?? false,
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  })
  return {
    query: <TRow, TParams extends TSqlParams>(sql: string) => {
      const statement = db.prepare(sql)
      return {
        all: (...params: TParams) =>
          statement.all(...bindings(params)).map((row) => ({ ...row }) as TRow),
        get: (...params: TParams) => {
          const row = statement.get(...bindings(params))
          return row === undefined ? undefined : ({ ...row } as TRow)
        },
        values: (...params: TParams) => {
          const arrays = db.prepare(sql)
          arrays.setReturnArrays(true)
          return arrays.all(...bindings(params)) as unknown as unknown[][]
        },
        run: (...params: TParams) => {
          statement.run(...bindings(params))
        },
      }
    },
    run: (sql, params) => {
      if (params === undefined) db.exec(sql)
      else db.prepare(sql).run(...bindings(params))
    },
    exec: (sql) => {
      db.exec(sql)
    },
    transaction: (work) => {
      db.exec('BEGIN')
      // biome-ignore lint/plugin/no-intermediate-try-catch: transaction boundary must roll back before propagating the original failure
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close: () => {
      const keeper = safeParseSettlement(() => {
        if (options.readonly || path === ':memory:') return undefined
        // The last connection must be read-only to preserve WAL sidecars for Bun readers.
        db.exec('PRAGMA busy_timeout=0; PRAGMA wal_checkpoint(TRUNCATE);')
        const reader = new DatabaseSync(path, {
          readOnly: true,
          enableForeignKeyConstraints: false,
          enableDoubleQuotedStringLiterals: true,
        })
        // biome-ignore lint/plugin/no-intermediate-try-catch: this connection boundary must release the reader if priming it fails
        try {
          reader.prepare('SELECT count(*) FROM sqlite_master').get()
          return reader
        } catch (error) {
          reader.close()
          throw error
        }
      })
      try {
        db.close()
      } finally {
        if (keeper.status === 'ok') keeper.data?.close()
      }
    },
  }
}
