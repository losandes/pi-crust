import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activityRunParams } from '../typedefs/activity-run'
import { createTracer, MIGRATIONS } from './trace-db'

const scratch = (): string =>
  mkdtempSync(join(tmpdir(), 'crust-trace-db-test-'))

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

/** Every column covered by any index on `table`, including the primary key's autoindex. */
const indexedColumns = (dbPath: string, table: string): readonly string[] => {
  const db = new Database(dbPath, { readonly: true })
  const indexes = db
    .query<{ name: string }, []>(`PRAGMA index_list(${table})`)
    .all()
  const columns = indexes.flatMap((index) =>
    db
      .query<{ name: string | null }, []>(`PRAGMA index_info(${index.name})`)
      .all()
      .map((column) => column.name),
  )
  db.close()
  return columns.filter((name): name is string => name !== null)
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
    const tracer = createTracer(
      join(dir, 'crust.db'),
      join(dir, 'events.jsonl'),
    )
    tracer.close()

    // then
    expect(tableNames(join(dir, 'crust.db'))).toEqual([
      'activity_runs',
      'agent_sessions',
      'envelopes',
      'events',
      'gate_results',
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
    'given data/trace-db::sessionWorkspace',
    'when a workspace is nested inside a larger VCS root',
    'it should record vcs_root alongside workspace_root, covering 1.5.2 of specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('a1b2c3d4', 'tester', 'quality')

    // when
    tracer.sessionWorkspace(
      'a1b2c3d4',
      '/trees/feature-x/_newstack',
      'andy/feature-x',
      '/trees/feature-x',
    )
    tracer.close()

    // then
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<{ vcs_root: string | null }, [string]>(
        'SELECT vcs_root FROM sessions WHERE run_id = ?',
      )
      .get('a1b2c3d4')
    db.close()
    expect(row?.vcs_root).toEqual('/trees/feature-x')
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
      activity_run_id: 'a1b2c3d4_01_request',
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

test(
  [
    'given data/trace-db::sessionStart',
    'when a name is given',
    'it should SET sessions.name, leaving lifecycle on its own column',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))

    // when
    tracer.sessionStart('a1b2c3d4', 'tester', 'quality', 'payments rewrite')
    tracer.close()

    // then
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<{ lifecycle: string; name: string | null }, []>(
        'SELECT lifecycle, name FROM sessions',
      )
      .get()
    db.close()
    expect(row).toEqual({ lifecycle: 'quality', name: 'payments rewrite' })
  },
)

test(
  [
    'given data/trace-db::sessionStart',
    'when a second sessionStart carries no name',
    'it should leave the recorded name untouched, so a resume that omits --name does not erase the label',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const first = createTracer(dbPath, join(dir, 'events.jsonl'))
    first.sessionStart('a1b2c3d4', 'tester', 'quality', 'payments rewrite')
    first.close()

    // when — a resume that did not repeat --name
    const second = createTracer(dbPath, join(dir, 'events.jsonl'))
    second.sessionStart('a1b2c3d4', 'tester', 'document')
    second.close()

    // then
    const db = new Database(dbPath, { readonly: true })
    const row = db
      .query<{ name: string | null }, []>('SELECT name FROM sessions')
      .get()
    db.close()
    expect(row).toEqual({ name: 'payments rewrite' })
  },
)

test(
  [
    'given data/trace-db::SCHEMA',
    'when a database is opened',
    'it should index events.run_id',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))

    // when
    tracer.close()

    // then
    expect(indexedColumns(dbPath, 'events')).toContain('run_id')
  },
)

test(
  [
    'given apps/visualizer/server/db.ts::agentsFor',
    'when its events+activity_runs lookup runs against an indexed database',
    'it should search idx_events_run_id instead of scanning events',
  ].join(', '),
  () => {
    // given — the same shape agentsFor() queries on every 500ms poll
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('a1b2c3d4', 'tester', 'quality')
    const activityRun = {
      activity_run_id: 'a1b2c3d4_01_identify',
      run_id: 'a1b2c3d4',
      seq: 1,
      params: activityRunParams({
        name: 'identify',
        kind: 'agent',
        owner: 'quality',
        description: 'Identify the request',
      }),
      status: 'running' as const,
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: undefined,
    }
    tracer.activityRunUpsert(activityRun)
    tracer.event({
      run_id: 'a1b2c3d4',
      activity_run_id: activityRun.activity_run_id,
      type: 'agent_start',
      name: 'agent_start',
    })
    tracer.close()

    // when
    const db = new Database(dbPath, { readonly: true })
    const plan = db
      .query<{ detail: string }, [string, string, string]>(
        `EXPLAIN QUERY PLAN
         SELECT e.run_id, p.owner AS agent, e.payload_json, e.started_at
           FROM events e JOIN activity_runs p ON p.activity_run_id = e.activity_run_id
          WHERE e.run_id IN (?, ?, ?) AND e.type = 'agent_start'
          ORDER BY e.rowid`,
      )
      .all('a1b2c3d4', 'b2c3d4e5', 'c3d4e5f6')
      .map((row) => row.detail)
    db.close()

    // then
    expect(plan.some((step) => step.includes('idx_events_run_id'))).toEqual(
      true,
    )
    expect(plan.some((step) => /SCAN\s+(e|events)\b/.test(step))).toEqual(false)
  },
)

test(
  [
    'given apps/visualizer/server/db.ts::agentsFor',
    'when its events+activity_runs lookup runs against an indexed database, covering SC4',
    'it should return exactly the agent_start rows for the requested runs, and none for a run that was not asked for',
  ].join(', '),
  () => {
    // given — one requested run, one unrequested run whose event must not leak in
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('a1b2c3d4', 'tester', 'quality')
    tracer.sessionStart('deadbeef', 'tester', 'quality')
    const requestedRun = {
      activity_run_id: 'a1b2c3d4_01_identify',
      run_id: 'a1b2c3d4',
      seq: 1,
      params: activityRunParams({
        name: 'identify',
        kind: 'agent',
        owner: 'quality',
        description: 'Identify the request',
      }),
      status: 'running' as const,
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: undefined,
    }
    const otherRun = {
      activity_run_id: 'deadbeef_01_identify',
      run_id: 'deadbeef',
      seq: 1,
      params: activityRunParams({
        name: 'identify',
        kind: 'agent',
        owner: 'builder',
        description: 'Identify the request',
      }),
      status: 'running' as const,
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: undefined,
    }
    tracer.activityRunUpsert(requestedRun)
    tracer.activityRunUpsert(otherRun)
    tracer.event({
      run_id: 'a1b2c3d4',
      activity_run_id: requestedRun.activity_run_id,
      type: 'agent_start',
      name: 'agent_start',
    })
    tracer.event({
      run_id: 'deadbeef',
      activity_run_id: otherRun.activity_run_id,
      type: 'agent_start',
      name: 'agent_start',
    })
    tracer.close()

    // when — the same shape agentsFor() runs, asking only for the first run
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .query<{ run_id: string; agent: string }, [string]>(
        `SELECT e.run_id, p.owner AS agent
           FROM events e JOIN activity_runs p ON p.activity_run_id = e.activity_run_id
          WHERE e.run_id IN (?) AND e.type = 'agent_start'
          ORDER BY e.rowid`,
      )
      .all('a1b2c3d4')
    db.close()

    // then — indexing the lookup must not change what it finds
    expect(rows).toEqual([{ run_id: 'a1b2c3d4', agent: 'quality' }])
  },
)

test(
  [
    'given data/trace-db::createTracer',
    'when it reopens a database that already existed and already held events',
    'it should still index events.run_id, and keep the rows that were already there',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const first = createTracer(dbPath, join(dir, 'events.jsonl'))
    first.sessionStart('a1b2c3d4', 'tester', 'quality')
    first.event({ run_id: 'a1b2c3d4', type: 'log', name: 'request' })
    first.close()

    // when
    const second = createTracer(dbPath, join(dir, 'events.jsonl'))
    second.close()

    // then
    expect(indexedColumns(dbPath, 'events')).toContain('run_id')
    const db = new Database(dbPath, { readonly: true })
    const count = db
      .query<{ total: number }, []>('SELECT COUNT(*) AS total FROM events')
      .get()
    db.close()
    expect(count?.total).toEqual(1)
  },
)
