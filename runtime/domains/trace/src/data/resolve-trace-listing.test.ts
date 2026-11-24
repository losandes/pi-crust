import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTraceListing } from './resolve-trace-listing'
import { SCHEMA } from './trace-db'

test(
  [
    'given twelve sessions and related rows',
    'when listed',
    'it should filter order limit and render SQLite text',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-listing-'))
    const path = join(root, 'trace.db')
    const db = new Database(path)
    db.exec(SCHEMA)
    for (let index = 0; index < 12; index++)
      db.run(
        'insert into sessions(run_id, status, request, started_at, total_tokens, total_cost) values (?, ?, ?, ?, ?, ?)',
        [
          `run${index}`,
          'ok',
          'x'.repeat(60),
          String(index).padStart(2, '0'),
          index,
          0,
        ],
      )
    db.run(
      "insert into activity_runs(activity_run_id, run_id, seq, name, kind, status) values ('b', 'run11', 2, 'build', 'agent', 'ok'), ('a', 'run11', 1, 'plan', 'agent', 'ok')",
    )
    db.run(
      "insert into processes(run_id, kind, name, pid, command, started_at, ended_at) values ('run11', 'agent', 'live', 12, 'bun', 'now', NULL), ('run11', 'agent', 'ended', 13, 'bun', 'then', 'now')",
    )
    for (let index = 0; index < 27; index++)
      db.run(
        'insert into events(event_id, run_id, type, name, started_at) values (?, ?, ?, ?, ?)',
        [String(index), 'run11', 'type', `event${index}`, 'now'],
      )
    db.close()
    try {
      // when
      const sessions = resolveTraceListing(path)('sessions', undefined)
      const activities = resolveTraceListing(path)('activity-runs', 'run11')
      const procs = resolveTraceListing(path)('procs', 'run11')
      const tail = resolveTraceListing(path)('tail', 'run11')
      // then
      expect(sessions.status === 'ok' && sessions.data.length).toBe(10)
      expect(sessions.status === 'ok' && sessions.data[0]).toBe(
        `run11|ok|${'x'.repeat(50)}|11|0.0`,
      )
      expect(activities).toEqual({
        status: 'ok',
        data: ['1|plan|agent||ok', '2|build|agent||ok'],
      })
      expect(procs).toEqual({ status: 'ok', data: ['agent|live|12|bun|now'] })
      expect(tail.status === 'ok' && tail.data.length).toBe(25)
      expect(tail.status === 'ok' && tail.data[0]).toBe('27|type|event26|now')
      for (const listing of ['activity-runs', 'tail', 'procs'] as const)
        expect(resolveTraceListing(path)(listing, 'unknown')).toEqual({
          status: 'ok',
          data: [],
        })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

for (const mode of ['missing', 'invalid', 'no-table'] as const) {
  test(
    [
      `given a ${mode} database`,
      `when listed`,
      `it should settle without changing bytes`,
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-listing-error-'))
      const path = join(root, 'trace.db')
      if (mode === 'invalid') writeFileSync(path, 'not sqlite')
      if (mode === 'no-table') {
        const db = new Database(path)
        db.exec('create table other (id integer)')
        db.close()
      }
      const before = existsSync(path) ? readFileSync(path) : undefined
      try {
        // when
        const result = resolveTraceListing(path)('sessions', undefined)
        // then
        expect(result.status).toBe('error')
        expect(result.status === 'error' && result.error.message).toStartWith(
          mode === 'missing'
            ? `no trace database at ${path}`
            : `cannot read ${path}: `,
        )
        if (before) expect(readFileSync(path)).toEqual(before)
        else expect(existsSync(path)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
