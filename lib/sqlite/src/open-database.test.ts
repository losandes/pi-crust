import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSqlite, openDatabase } from './open-database'

test(
  [
    'given a disposable database',
    'when statements bind absent and boolean values',
    'it should expose plain rows, ordered values and transactional results',
  ].join(', '),
  () => {
    // given
    const db = openDatabase(':memory:')
    try {
      db.run('CREATE TABLE items (a, b, c); CREATE TABLE extra (id);')
      // when
      db.run('INSERT INTO items VALUES (?, ?, ?)', [undefined, true, false])
      const query = db.query<{ a: unknown; b: number; c: number }, []>(
        'SELECT * FROM items',
      )
      const row = query.get()
      if (row === undefined) throw new Error('inserted row not found')
      // then
      expect(row).toEqual({ a: null, b: 1, c: 0 })
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
      expect(query.all()).toEqual([row])
      expect(query.values()).toEqual([[null, 1, 0]])
      expect(db.query('SELECT * FROM extra').get()).toBeUndefined()
      expect(
        db.transaction(() => {
          db.exec('INSERT INTO extra VALUES (7)')
          return 42
        }),
      ).toBe(42)
      expect(() =>
        db.transaction(() => {
          db.exec('INSERT INTO extra VALUES (8)')
          throw new Error('rollback')
        }),
      ).toThrow('rollback')
      expect(db.query('SELECT * FROM extra').all()).toEqual([{ id: 7 }])
      const bound = db.query('SELECT ? AS a, ? AS b, ? AS c')
      expect(bound.get(undefined, true, false)).toEqual(row)
      expect(bound.all(undefined, true, false)).toEqual([row])
      expect(bound.values(undefined, true, false)).toEqual([[null, 1, 0]])
      db.query('INSERT INTO items VALUES (?, ?, ?)').run(undefined, true, false)
      expect(query.all()).toHaveLength(2)
      db.run(
        'CREATE TABLE refs (id REFERENCES extra(id)); INSERT INTO refs VALUES (99)',
      )
      expect(db.query('SELECT "literal" AS text').get()).toEqual({
        text: 'literal',
      })
    } finally {
      db.close()
    }
  },
)

for (const wal of [false, true]) {
  test(
    [
      `given a closed ${wal ? 'WAL' : 'ordinary'} database`,
      'when reopened read-only',
      'it should read its committed rows and refuse missing files',
    ].join(', '),
    () => {
      // given
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crust-sqlite-')))
      const path = join(dir, 'trace.db')
      try {
        const writer = openDatabase(path)
        if (wal) writer.exec('PRAGMA journal_mode=WAL')
        writer.exec('CREATE TABLE items (id); INSERT INTO items VALUES (1)')
        writer.close()
        if (wal) {
          expect(existsSync(`${path}-wal`)).toBe(true)
          expect(existsSync(`${path}-shm`)).toBe(true)
        }
        const legacy = new Database(path, { readonly: true })
        try {
          expect(legacy.query('SELECT * FROM items').all()).toEqual([{ id: 1 }])
        } finally {
          legacy.close()
        }
        // when
        const reader = openDatabase(path, { readonly: true })
        try {
          // then
          expect(reader.query('SELECT * FROM items').all()).toEqual([{ id: 1 }])
          expect(() => reader.run('INSERT INTO items VALUES (2)')).toThrow()
        } finally {
          reader.close()
        }
        expect(() =>
          openDatabase(join(dir, 'missing.db'), { readonly: true }),
        ).toThrow()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

for (const throws of [false, true]) {
  test(
    [
      'given a warning emitter',
      `when loading SQLite ${throws ? 'fails' : 'succeeds'}`,
      'it should suppress only its experimental warning and restore the emitter',
    ].join(', '),
    () => {
      // given
      const sqliteModule = loadSqlite()
      const warnings = new Map<number, unknown[]>()
      const original = ((...args: unknown[]) =>
        warnings.set(warnings.size, args)) as typeof process.emitWarning
      const emitter = {
        emitWarning: original,
        getBuiltinModule: (() => {
          emitter.emitWarning('SQLite is experimental', 'ExperimentalWarning')
          emitter.emitWarning('another warning', 'ExperimentalWarning')
          emitter.emitWarning('SQLite warning', { type: 'OtherWarning' })
          if (throws) throw new Error('load failed')
          return sqliteModule
        }) as typeof process.getBuiltinModule,
      }
      // when
      if (throws) expect(() => loadSqlite(emitter)).toThrow('load failed')
      else expect(loadSqlite(emitter)).toBe(sqliteModule)
      // then
      expect([...warnings.values()]).toEqual([
        ['another warning', 'ExperimentalWarning'],
        ['SQLite warning', { type: 'OtherWarning' }],
      ])
      expect(emitter.emitWarning).toBe(original)
    },
  )
}
