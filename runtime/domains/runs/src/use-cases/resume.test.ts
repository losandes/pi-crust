import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TRun } from '../../../../lib/contracts'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import {
  recordStepResult,
  replayStepResult,
  resumableActivityRun,
  skipIfDone,
} from './resume'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

const runWith = (completed: readonly string[]): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
  return createRun({
    cfg: crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'runtime') },
      observability: {},
      agents: [],
    }),
    runId: 'aaaa1111',
    tracer,
    engineer: 'tester',
    resume: new Set(completed),
  })
}

const params = activityRunParams({
  name: 'build',
  kind: 'code',
  owner: 'quality',
  description: 'Do the build work so there is something to resume past',
})

const run = async () => 'ran'
const replay = async () => 'replayed'

test(
  [
    'given use-cases/resume::skipIfDone',
    'when the activityRun is not in the completed set',
    'it should run the body and open an activity run row',
  ].join(', '),
  async () => {
    // given
    const given = runWith([])

    // when
    const actual = await skipIfDone(given, params, run, replay)

    // then
    expect(actual).toEqual('ran')
    expect(
      given.activityRuns().map((activityRun) => activityRun.params.name),
    ).toEqual(['build'])
  },
)

test(
  [
    'given use-cases/resume::skipIfDone',
    'when the activityRun already succeeded in this session',
    'it should replay it and count it, without opening a second db row',
  ].join(', '),
  async () => {
    // given a duplicate DB row would corrupt the completed set the next
    // resume reads — but the run still has to know the activityRun succeeded
    const given = runWith(['build'])

    // when
    const actual = await skipIfDone(given, params, run, replay)

    // then
    expect(actual).toEqual('replayed')
    // recorded in THIS run's activityRuns, because `finish` judges the run by them:
    // a resumed chain that re-ran nothing was reported failed having done
    // everything asked of it
    expect(
      given.activityRuns().map((activityRun) => activityRun.status),
    ).toEqual(['success'])
    expect(given.activityRuns()[0]?.activity_run_id).toContain('replayed')
  },
)

test(
  [
    'given use-cases/resume::recordStepResult, replayStepResult',
    'when a code activityRun records its verdict and a later replay reads it back',
    'it should return the same payload, keyed by the activityRun\u2019s name',
  ].join(', '),
  () => {
    // given
    const given = runWith([])
    given.tracer.sessionStart(given.runId, 'tester', 'sdlc')
    const handle = {
      activityRun: {
        activity_run_id: `${given.runId}_01_build`,
        run_id: given.runId,
        seq: 1,
        params,
        status: 'running',
        error: undefined,
        started_at: new Date().toISOString(),
        ended_at: undefined,
      },
      log: () => undefined,
    } as unknown as Parameters<typeof recordStepResult>[1]
    given.tracer.activityRunUpsert(
      (
        handle as unknown as {
          activityRun: Parameters<typeof given.tracer.activityRunUpsert>[0]
        }
      ).activityRun,
    )

    // when
    recordStepResult(given, handle, { decision: 'approved' })
    const actual = replayStepResult(given, 'build')

    // then
    expect(actual).toEqual({ decision: 'approved' })
  },
)

test(
  [
    'given use-cases/resume::replayStepResult',
    'when no run exists in the trace at all',
    'it should answer undefined rather than throw',
  ].join(', '),
  () => {
    // given
    const given = runWith([])

    // when
    const actual = replayStepResult(given, 'never-ran')

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given use-cases/resume::resumableActivityRun',
    'when the activityRun has not completed yet',
    'it should behave exactly like skipIfDone, running the body',
  ].join(', '),
  async () => {
    // given
    const given = runWith([])

    // when
    const actual = await resumableActivityRun(given)(params, run, replay)

    // then
    expect(actual).toEqual('ran')
  },
)

test(
  [
    'given use-cases/resume::skipIfDone',
    'when the same name is touched a second time in this process',
    'it should execute the body for real, per requirement 1.1.2',
  ].join(', '),
  async () => {
    // given — the credit a resumed session grants 'build' is spent on the
    // first call; the second call stands for a gate-triggered retry the
    // run itself decides to make
    const given = runWith(['build'])
    let bodyRuns = 0
    const ranAgain = () => {
      bodyRuns += 1
      return Promise.resolve('ran-again')
    }

    // when
    const first = await skipIfDone(given, params, run, replay)
    const second = await skipIfDone(given, params, ranAgain, replay)

    // then
    expect(first).toEqual('replayed')
    expect(second).toEqual('ran-again')
    expect(bodyRuns).toEqual(1)
  },
)
