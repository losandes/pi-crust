import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer, MIGRATIONS } from './trace-db'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-trace-db-test-'))

const tableNames = (dbPath: string): readonly string[] => {
  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all()
  db.close()
  return rows.map((row) => row.name)
}

test(
  [
    'given data/trace-db::createTracer',
    'when a database is opened for the first time',
    'it should create every table the visualizer reads',
  ].join(', '),
  () => {
    // given
    const dir = scratch()

    // when
    const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
    tracer.close()

    // then
    expect(tableNames(join(dir, 'crust.db'))).toEqual([
      'agent_sessions',
      'envelopes',
      'events',
      'gate_results',
      'phases',
      'processes',
      'sessions',
      'sqlite_sequence',
    ])
  },
)

test(
  [
    'given data/trace-db::createTracer',
    'when the same database is opened a second time',
    'it should migrate idempotently and keep the earlier rows',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const first = createTracer(dbPath, join(dir, 'events.jsonl'))
    first.sessionStart('a1b2c3d4', 'tester', 'quality')
    first.close()

    // when
    const second = createTracer(dbPath, join(dir, 'events.jsonl'))
    second.sessionStart('a1b2c3d4', 'tester', 'document')
    second.close()

    // then
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<{ lifecycle: string; status: string }, []>(
        'SELECT lifecycle, status FROM sessions',
      )
      .get()
    db.close()
    expect(row).toEqual({ lifecycle: 'quality + document', status: 'running' })
  },
)

test(
  [
    'given data/trace-db::sessionWorkspace',
    'when a run records the working tree it is executing in',
    'it should keep it on the session, and leave it unknown until it does',
  ].join(', '),
  () => {
    // given — one observer may watch several working trees, so a run that
    // cannot name its own is a run the reader cannot act on. A row written
    // before this existed has to read as unknown, never as the observer's
    // own tree.
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('a1b2c3d4', 'tester', 'quality')
    tracer.sessionStart('e5f6a7b8', 'tester', 'quality')

    // when — only the first run says where it is
    tracer.sessionWorkspace('a1b2c3d4', '/trees/feature-x', 'andy/feature-x')
    tracer.close()

    // then
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .query<
        {
          run_id: string
          workspace_root: string | null
          branch: string | null
        },
        []
      >('SELECT run_id, workspace_root, branch FROM sessions ORDER BY run_id')
      .all()
    db.close()
    expect(rows).toEqual([
      {
        run_id: 'a1b2c3d4',
        workspace_root: '/trees/feature-x',
        branch: 'andy/feature-x',
      },
      { run_id: 'e5f6a7b8', workspace_root: null, branch: null },
    ])
  },
)

test(
  [
    'given data/trace-db::MIGRATIONS',
    'when a database predates an additive column',
    'it should gain the column on the next open',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const legacy = new Database(dbPath, { create: true })
    legacy.run(
      'CREATE TABLE sessions (run_id TEXT PRIMARY KEY, request TEXT, status TEXT,' +
        ' engineer TEXT, started_at TEXT, ended_at TEXT, total_tokens INTEGER,' +
        ' total_cost REAL)',
    )
    legacy.close()

    // when
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()

    // then
    const db = new Database(dbPath, { readonly: true })
    const columns = db
      .query<{ name: string }, []>('PRAGMA table_info(sessions)')
      .all()
      .map((column) => column.name)
    db.close()
    const expected = MIGRATIONS.filter(([table]) => table === 'sessions').map(
      ([, column]) => column,
    )
    expect(expected.every((column) => columns.includes(column))).toEqual(true)
  },
)

test(
  [
    'given data/trace-db::event',
    'when an event is recorded',
    'it should append the raw JSONL line and insert the queryable row together',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const eventsPath = join(dir, 'events.jsonl')
    const tracer = createTracer(dbPath, eventsPath)

    // when
    const eventId = tracer.event({
      run_id: 'a1b2c3d4',
      phase_id: 'a1b2c3d4_01_request',
      type: 'log',
      name: 'request',
      payload: { message: 'hello' },
    })
    tracer.close()

    // then
    const line = JSON.parse(readFileSync(eventsPath, 'utf8').trim())
    expect(line.event_id).toEqual(eventId)
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<
        { type: string; payload_json: string; ended_at: string | null },
        []
      >('SELECT type, payload_json, ended_at FROM events')
      .get()
    db.close()
    expect(row).toEqual({
      type: 'log',
      payload_json: '{"message":"hello"}',
      ended_at: null,
    })
  },
)
