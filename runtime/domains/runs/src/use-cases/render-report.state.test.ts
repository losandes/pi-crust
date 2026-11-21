import { expect, test } from 'bun:test'

import { mkdtempSync } from 'node:fs'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import type {
  TActivityRun,
  TActivityRunStatus,
  TRunState,
  TTracer,
} from '../../../../lib/contracts'

import {
  activityRunParams,
  WARNING_EVENT,
  warningPayload,
} from '../../../../lib/contracts'
import { createTracer, readRunState } from '../../../trace'
import { renderReport } from './render-report'

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
    'when a run warned about a change it could not attribute',
    'it should carry that warning into the state the reporter prints',
  ].join(', '),
  () => {
    // given
    /*
     * given — a developer asking a finished run what happened is usually not
     * the person who watched it happen, so the terminal cannot be the only
     * surface that says it.
     */
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'aaaa1111', [[1, 'build', 'success']])
    tracer.event({
      run_id: 'aaaa1111',
      activity_run_id: 'aaaa1111_01_build',
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload({
        kind: 'unexpected',
        activities: ['build'],
        activityRunIds: ['aaaa1111_01_build'],
        stage: 'implement',
        paths: ['src/add.ts'],
        note: '',
      }),
    })
    tracer.close()

    // when
    const actual = readRunState(dbPath, 'aaaa1111')

    // then
    expect(actual?.warnings).toEqual([
      {
        kind: 'unexpected',
        activities: ['build'],
        activityRunIds: ['aaaa1111_01_build'],
        stage: 'implement',
        paths: ['src/add.ts'],
        note: '',
      },
    ])
    expect(renderReport(actual as TRunState)).toContain('src/add.ts')
  },
)

test(
  [
    'given ../../report::renderReport',
    'when the state carries a --name',
    'it should show the name on the workflow line and the lifecycle beneath it',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('a1b2c3d4', 'tester', 'sdlc', 'payments rewrite')
    tracer.close()
    const state = readRunState(dbPath, 'a1b2c3d4') as TRunState

    // when
    const actual = renderReport(state)

    // then
    expect(actual).toContain('payments rewrite')
    expect(actual).toContain('lifecycle:')
    expect(actual).toContain('sdlc')
  },
)

test(
  [
    'given ../../report::renderReport',
    'when a run died between Activities, leaving every RECORDED Activity Run green',
    'it should still print the resume command, above a line saying the run did not finish',
  ].join(', '),
  () => {
    // given — run fbf49583's exact shape: status fail, resume_from undefined
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    session(tracer, 'fbf49583', [
      [1, 'request', 'success'],
      [2, 'plan', 'success'],
    ])
    tracer.sessionFinish('fbf49583', false)
    tracer.close()
    const state = readRunState(dbPath, 'fbf49583') as TRunState

    // when
    const actual = renderReport(state)

    // then
    expect(actual).not.toContain(
      'every activity run succeeded — nothing to resume',
    )
    expect(actual).toContain('did not finish')
  },
)

test(
  [
    'given ../../report::renderReport',
    'when a run finished successfully',
    'it should print the green nothing-to-resume line',
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
    const state = readRunState(dbPath, 'bbbb2222') as TRunState

    // when
    const actual = renderReport(state)

    // then
    expect(actual).toContain('every activity run succeeded — nothing to resume')
  },
)
