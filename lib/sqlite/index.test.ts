import { expect, test } from 'bun:test'
import { openDatabase } from './index'

test(
  [
    'given the public SQLite adapter',
    'when opening an in-memory database',
    'it should execute a statement through the public API',
  ].join(', '),
  () => {
    // given
    // when
    const db = openDatabase(':memory:')
    try {
      // then
      expect(db.query('SELECT 1 AS value').get()).toEqual({ value: 1 })
    } finally {
      db.close()
    }
  },
)
