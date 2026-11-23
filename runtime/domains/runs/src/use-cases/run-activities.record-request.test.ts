import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TRun } from '../../../../lib/contracts'
import { crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { RUN_START, recordRunStart } from '../../../policy'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { recordRequest } from './run-activities'

const aRun = (): TRun & Disposable => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-activities-request-'))
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
  silenceTerminal()
  const run = createRun({
    cfg: crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'runtime') },
      observability: {},
      agents: [],
    }),
    runId: 'aaaa1111',
    tracer,
    engineer: 'tester',
  })
  return {
    ...run,
    [Symbol.dispose]: () => {
      tracer.close()
      rmSync(dir, { recursive: true, force: true })
      restoreTerminal()
    },
  }
}

test(
  [
    'given use-cases/run-activities::recordRequest',
    'when the incoming ask is captured for the first time',
    'it should open an activity run row and log the prompt',
  ].join(', '),
  async () => {
    // given
    using run = aRun()

    // when
    await recordRequest(run, 'add a /health endpoint')

    // then
    expect(
      run.activityRuns().map((activityRun) => activityRun.params.name),
    ).toEqual(['request'])
  },
)

test(
  [
    'given use-cases/run-activities::recordRequest',
    'when extra fields are given alongside the prompt',
    'it should still succeed, carrying them into the logged event',
  ].join(', '),
  async () => {
    // given
    using run = aRun()

    // when, then
    await expect(
      recordRequest(run, 'add a /health endpoint', { lifecycle: 'sdlc' }),
    ).resolves.toBeUndefined()
  },
)

test(
  [
    'given use-cases/run-activities::recordRequest',
    'when the request was already recorded in a resumed session',
    'it should skip re-recording it',
  ].join(', '),
  async () => {
    // given — the first call records it
    using run = aRun()
    await recordRequest(run, 'add a /health endpoint')

    // when — a second, resumed run with the same name already completed
    const resumedDir = mkdtempSync(
      join(tmpdir(), 'crust-run-activities-request-resumed-'),
    )
    const resumedTracer = createTracer(
      join(resumedDir, 'crust.db'),
      join(resumedDir, 'events.jsonl'),
    )
    const resumed = createRun({
      cfg: crustConfigSchema.parse({
        defaults: { data_dir: join(resumedDir, 'runtime') },
        observability: {},
        agents: [],
      }),
      runId: 'bbbb2222',
      tracer: resumedTracer,
      engineer: 'tester',
      resume: new Set(['request']),
    })
    await recordRequest(resumed, 'add a /health endpoint')

    // then — recorded as a replay, not a second fresh activity run
    expect(resumed.activityRuns()[0]?.activity_run_id).toContain('replayed')
  },
)

for (const mode of ['first', 'resume', 'join'] as const) {
  test(
    [
      `given a ${mode} request invocation`,
      'when recording the run start from its callback',
      'it should retain one event under the original request Activity Run',
    ].join(', '),
    async () => {
      // given
      using run = aRun()
      const ports = {
        rev: () => 'original-head',
        content: () => ({ status: 'ok' as const, data: {} }),
      }
      const onRecorded = (
        handle: Parameters<NonNullable<Parameters<typeof recordRequest>[3]>>[0],
      ) => recordRunStart(ports)(run, handle.activityRun.activity_run_id)
      await recordRequest(run, 'request', {}, onRecorded)
      const original = run.activityRuns()[0]?.activity_run_id
      // when
      if (mode !== 'first') {
        const next = createRun({
          cfg: run.cfg,
          runId: run.runId,
          tracer: run.tracer,
          engineer: 'tester',
          ...(mode === 'resume' ? { resume: new Set(['request']) } : {}),
        })
        await recordRequest(next, 'request', {}, (handle) => {
          if (mode === 'resume')
            throw new Error('replay must not call onRecorded')
          recordRunStart(ports)(next, handle.activityRun.activity_run_id)
        })
      }
      // then
      expect(run.tracer.eventsNamed(run.runId, RUN_START)).toEqual([
        { head: 'original-head', tree: {} },
      ])
      const rows = run.tracer.activityRunsFor(run.runId)
      expect(
        rows.find((row) => row.activity_run_id === original)?.params.name,
      ).toBe('request')
    },
  )
}
