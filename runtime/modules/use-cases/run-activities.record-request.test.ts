import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { restoreTerminal, silenceTerminal } from '../testing/terminal-capture'
import { crustConfigSchema } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import { createRun } from './create-run'
import { recordRequest } from './run-activities'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

const aRun = (): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-activities-request-'))
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
  return createRun({
    cfg: crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'runtime') },
      observability: { db: join(dir, 'crust.db') },
      agents: [],
    }),
    runId: 'aaaa1111',
    tracer,
    engineer: 'tester',
  })
}

test(
  [
    'given use-cases/run-activities::recordRequest',
    'when the incoming ask is captured for the first time',
    'it should open an activity run row and log the prompt',
  ].join(', '),
  async () => {
    // given
    const run = aRun()

    // when
    await recordRequest(run, 'add a /health endpoint')

    // then
    expect(run.activityRuns().map((activityRun) => activityRun.params.name)).toEqual([
      'request',
    ])
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
    const run = aRun()

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
    const run = aRun()
    await recordRequest(run, 'add a /health endpoint')

    // when — a second, resumed run with the same name already completed
    const resumedDir = mkdtempSync(join(tmpdir(), 'crust-run-activities-request-resumed-'))
    const resumedTracer = createTracer(
      join(resumedDir, 'crust.db'),
      join(resumedDir, 'events.jsonl'),
    )
    const resumed = createRun({
      cfg: crustConfigSchema.parse({
        defaults: { data_dir: join(resumedDir, 'runtime') },
        observability: { db: join(resumedDir, 'crust.db') },
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
