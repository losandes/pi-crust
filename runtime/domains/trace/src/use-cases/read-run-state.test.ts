import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityRun,
  TActivityRunStatus,
  TTracer,
  TTreeWarning,
} from '../../../../lib/contracts'
import {
  activityRunParams,
  WARNING_EVENT,
  warningPayload,
} from '../../../../lib/contracts'
import { createTracer } from '../data/trace-db'
import { latestLogPayload, readRunState } from './read-run-state'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-run-state-'))

const activityRunRecord = (
  runId: string,
  seq: number,
  name: string,
  status: TActivityRunStatus,
): TActivityRun => ({
  activity_run_id: `${runId}_${String(seq).padStart(2, '0')}_${name}`,
  run_id: runId,
  seq,
  params: activityRunParams({
    name,
    kind: 'code',
    owner: 'quality',
    description: `Do the ${name} work and record what it found`,
  }),
  status,
  error: undefined,
  started_at: '2024-01-01T00:00:00.000Z',
  ended_at: '2024-01-01T00:00:01.000Z',
})

const session = (
  tracer: TTracer,
  runId: string,
  activityRuns: ReadonlyArray<readonly [number, string, TActivityRunStatus]>,
): void => {
  tracer.sessionStart(runId, 'tester', 'sdlc')
  tracer.sessionRequest(runId, 'add a /health endpoint')
  for (const [seq, name, status] of activityRuns) {
    tracer.activityRunUpsert(activityRunRecord(runId, seq, name, status))
  }
}

test(
  [
    'given use-cases/read-run-state::readRunState',
    'when an activity run name was run twice and the later run failed',
    'it should treat that activityRun as incomplete and resume from it',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'aaaa1111', [
      [1, 'request', 'success'],
      [2, 'build', 'success'],
      [3, 'build', 'fail'],
    ])
    tracer.close()

    // when
    const actual = readRunState(dbPath, 'aaaa1111')

    // then
    expect(actual?.completed).toEqual(['request'])
    expect(actual?.resume_from).toEqual('build')
  },
)

test(
  [
    'given use-cases/read-run-state::readRunState',
    'when every activity run succeeded',
    'it should report nothing to resume from',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'bbbb2222', [
      [1, 'request', 'success'],
      [2, 'build', 'success'],
    ])
    tracer.close()

    // when
    const actual = readRunState(dbPath, 'bbbb2222')

    // then
    expect(actual?.completed).toEqual(['request', 'build'])
    expect(actual?.resume_from).toBeUndefined()
  },
)

test(
  [
    'given use-cases/read-run-state::readRunState',
    'when a run died between Activities, leaving every RECORDED Activity Run green',
    'it should still say the session is resumable',
  ].join(', '),
  () => {
    // given
    /*
     * given — run fbf49583: a commit failed and killed the process before
     * the next Activity ever opened a row. `resume_from` cannot see what it
     * never recorded, so `resumable` has to come from the session's own
     * status instead.
     */
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'aaaa1111', [
      [1, 'request', 'success'],
      [2, 'plan', 'success'],
    ])
    tracer.sessionFinish('aaaa1111', false)
    tracer.close()

    // when
    const actual = readRunState(dbPath, 'aaaa1111')

    // then
    expect(actual?.resume_from).toBeUndefined()
    expect(actual?.resumable).toBe(true)
  },
)

test(
  [
    'given use-cases/read-run-state::readRunState',
    'when a run finished successfully',
    'it should say there is nothing left to resume',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'bbbb2222', [
      [1, 'request', 'success'],
      [2, 'build', 'success'],
    ])
    tracer.sessionFinish('bbbb2222', true)
    tracer.close()

    // when
    const actual = readRunState(dbPath, 'bbbb2222')

    // then
    expect(actual?.resumable).toBe(false)
  },
)

test(
  [
    'given use-cases/read-run-state::readRunState',
    'when the database does not exist',
    'it should answer undefined rather than create one',
  ].join(', '),
  () => {
    // given
    const dbPath = join(scratch(), 'absent.db')

    // when
    const actual = readRunState(dbPath)

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/read-run-state::latestLogPayload',
    'when a code activityRun recorded a verdict beside a console line',
    'it should return the verdict, not the console line',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'cccc3333', [[1, 'verify', 'success']])
    const activityRunId = 'cccc3333_01_verify'
    tracer.event({
      run_id: 'cccc3333',
      activity_run_id: activityRunId,
      type: 'log',
      name: 'step_result',
      payload: { passed: false, failures: ['lint: exited 1'] },
    })
    tracer.event({
      run_id: 'cccc3333',
      activity_run_id: activityRunId,
      type: 'log',
      name: 'verify',
      payload: { message: 'verify finished', level: 'info' },
    })
    tracer.close()

    // when
    const state = readRunState(dbPath, 'cccc3333')
    const actual =
      state === undefined
        ? undefined
        : latestLogPayload(state, 'verify', 'step_result')

    // then
    expect(actual).toEqual({ passed: false, failures: ['lint: exited 1'] })
  },
)

test(
  [
    'given use-cases/read-run-state::readRunState',
    'when the database predates the sessions.name column',
    'it should return name: \'\' rather than throw "no such column"',
  ].join(', '),
  () => {
    // given — a db an older pi-crust wrote, before `name` existed
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const legacy = new Database(dbPath, { create: true })
    legacy.run(
      'CREATE TABLE sessions (run_id TEXT PRIMARY KEY, lifecycle TEXT, request TEXT,' +
        ' status TEXT, engineer TEXT, started_at TEXT, ended_at TEXT,' +
        ' total_tokens INTEGER, total_cost REAL)',
    )
    legacy.run(
      'INSERT INTO sessions (run_id, lifecycle, status, engineer, started_at)' +
        " VALUES ('a1b2c3d4', 'sdlc', 'success', 'tester', '2024-01-01T00:00:00.000Z')",
    )
    legacy.run(
      'CREATE TABLE activity_runs (activity_run_id TEXT PRIMARY KEY, run_id TEXT,' +
        ' seq INTEGER, name TEXT, kind TEXT, owner TEXT, description TEXT,' +
        " status TEXT DEFAULT 'fail', error TEXT, started_at TEXT, ended_at TEXT)",
    )
    legacy.run(
      'CREATE TABLE events (event_id TEXT PRIMARY KEY, run_id TEXT, activity_run_id TEXT,' +
        ' parent_id TEXT, type TEXT, name TEXT, payload_json TEXT, tokens INTEGER,' +
        ' started_at TEXT, ended_at TEXT)',
    )
    legacy.run(
      'CREATE TABLE envelopes (envelope_id TEXT PRIMARY KEY, run_id TEXT,' +
        ' activity_run_id TEXT, agent TEXT, output_type TEXT, payload_json TEXT,' +
        ' valid INTEGER, created_at TEXT)',
    )
    legacy.run(
      'CREATE TABLE gate_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT,' +
        ' activity_run_id TEXT, gate TEXT, passed INTEGER, violations_json TEXT,' +
        ' checks_json TEXT, created_at TEXT)',
    )
    legacy.close()

    // when
    const actual = readRunState(dbPath, 'a1b2c3d4')

    // then
    expect(actual?.name).toEqual('')
  },
)

const uncommittedWarning: TTreeWarning = {
  kind: 'uncommitted',
  activities: ['build'],
  activityRunIds: ['aaaa1111_01_build'],
  stage: 'implement',
  paths: ['src/work.ts'],
  note: 'first refusal',
}
const recoveredWarning: TTreeWarning = {
  ...uncommittedWarning,
  kind: 'recovered',
  note: 'committed abc123',
}
const laterWarning: TTreeWarning = {
  ...uncommittedWarning,
  note: 'later refusal',
}
const otherWarning: TTreeWarning = {
  ...uncommittedWarning,
  kind: 'unexpected',
  note: 'unattributed',
}

for (const given of [
  {
    name: 'answered refusal',
    warnings: [uncommittedWarning, recoveredWarning],
    expected: [],
  },
  {
    name: 'later refusal replacing an earlier one',
    warnings: [uncommittedWarning, laterWarning],
    expected: [laterWarning],
  },
  {
    name: 'refusal filed after recovery',
    warnings: [uncommittedWarning, recoveredWarning, laterWarning],
    expected: [laterWarning],
  },
  {
    name: 'another kind alongside an answered refusal',
    warnings: [otherWarning, uncommittedWarning, recoveredWarning],
    expected: [otherWarning],
  },
]) {
  test(
    [
      `given a trace containing ${given.name}`,
      'when readRunState reports the run',
      'it should return only standing warnings in trace order',
    ].join(', '),
    () => {
      // given
      const dir = scratch()
      const dbPath = join(dir, 'crust.db')
      const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
      session(tracer, 'aaaa1111', [[1, 'build', 'success']])
      for (const warning of given.warnings) {
        tracer.event({
          run_id: 'aaaa1111',
          activity_run_id: 'aaaa1111_01_build',
          type: 'log',
          name: WARNING_EVENT,
          payload: warningPayload(warning),
        })
      }
      try {
        // when
        const actual = readRunState(dbPath, 'aaaa1111')

        // then
        expect(actual?.warnings).toEqual(given.expected)
      } finally {
        tracer.close()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
