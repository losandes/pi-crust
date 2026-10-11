import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TActivityRun } from '../typedefs/activity-run'
import { activityRunParams } from '../typedefs/activity-run'
import { createTracer } from './trace-db'

/**
 * A tracer over its own throwaway database, cleaned up by its own test.
 *
 * No afterEach: a lifecycle hook is shared mutable state across tests, and a
 * temp directory removed by a hook is removed whether or not the test that
 * made it got that far. Each test owns what it creates.
 */
const tracerIn = (): ReturnType<typeof createTracer> & {
  readonly dir: string
  readonly dispose: () => void
} => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-trace-'))
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
  return Object.assign(tracer, {
    dir,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  })
}

/** A activityRun mid-flight: written as `running`, never updated again. */
const openActivityRun = (
  tracer: ReturnType<typeof createTracer>,
  runId: string,
): TActivityRun => {
  tracer.sessionStart(runId, 'andy', 'sdlc')
  const activityRun: TActivityRun = {
    activity_run_id: `${runId}-identify`,
    run_id: runId,
    seq: 1,
    params: activityRunParams({
      name: 'identify',
      kind: 'agent',
      owner: 'analyst',
      description: 'Turn the problem into an outcome',
    }),
    status: 'running',
    attempt: 1,
    error: undefined,
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: undefined,
  }
  tracer.activityRunUpsert(activityRun)
  return activityRun
}

const activityRunRow = (
  tracer: ReturnType<typeof createTracer> & { readonly dir: string },
  activityRunId: string,
): Readonly<{ status: string; error: string | null; ended_at: string | null }> => {
  const db = new Database(join(tracer.dir, 'crust.db'), { readonly: true })
  const row = db
    .query('SELECT status, error, ended_at FROM activity_runs WHERE activity_run_id = ?')
    .get(activityRunId) as { status: string; error: string | null; ended_at: string | null }
  db.close()
  return row
}

test(
  [
    'given data/trace-db::sessionFinish',
    'when the run is killed while an activity run is still open',
    'it should close that activityRun rather than leaving it claiming to work',
  ].join(', '),
  () => {
    // given — Ctrl-C mid-stage: the signal handler finishes the session, and
    // the activityRun never reaches the update that would settle it
    const tracer = tracerIn()
    const activityRun = openActivityRun(tracer, 'a2f48b50')

    // when
    tracer.sessionFinish('a2f48b50', false)

    // then — a session reading `fail` above an activity run reading `running`, with no
    // process behind it, is indistinguishable from a live run to every reader
    const actual = activityRunRow(tracer, activityRun.activity_run_id)
    expect(actual.status).toBe('fail')
    expect(actual.ended_at).not.toBeNull()
    expect(actual.error).toContain('still running')
    tracer.dispose()
  },
)

test(
  [
    'given data/trace-db::sessionFinish',
    'when an activity run already settled before the run ended',
    'it should leave its verdict and its timing alone',
  ].join(', '),
  () => {
    // given
    const tracer = tracerIn()
    const activityRun = openActivityRun(tracer, 'b1')
    tracer.activityRunUpsert({
      ...activityRun,
      status: 'success',
      ended_at: '2026-01-01T00:01:00.000Z',
    })
    const settled = activityRunRow(tracer, activityRun.activity_run_id)

    // when
    tracer.sessionFinish('b1', true)

    // then — abandoning open activityRuns must never rewrite a finished one
    const actual = activityRunRow(tracer, activityRun.activity_run_id)
    expect(actual.status).toBe('success')
    expect(actual.ended_at).toBe(settled.ended_at)
    tracer.dispose()
  },
)

test(
  [
    'given data/trace-db::sessionWaiting',
    'when a run stops for a person',
    'it should not leave an activity run open either',
  ].join(', '),
  () => {
    // given — a gate opens between activityRuns, so an open one here means something
    // did not finish
    const tracer = tracerIn()
    const activityRun = openActivityRun(tracer, 'c1')

    // when
    tracer.sessionWaiting('c1')

    // then
    expect(activityRunRow(tracer, activityRun.activity_run_id).status).toBe('fail')
    tracer.dispose()
  },
)
