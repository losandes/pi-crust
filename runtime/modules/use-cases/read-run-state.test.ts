import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import type { TActivityRun, TActivityRunStatus } from '../typedefs/activity-run'
import { activityRunParams } from '../typedefs/activity-run'
import type { TTracer } from '../typedefs/trace'
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
