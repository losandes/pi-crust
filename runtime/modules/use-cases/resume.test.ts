import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { crustConfigSchema } from '../typedefs/config'
import { activityRunParams } from '../typedefs/activity-run'
import type { TRun } from '../typedefs/run'
import { createRun } from './create-run'
import { skipIfDone } from './resume'

const runWith = (completed: readonly string[]): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))
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
    resume: new Set(completed),
  })
}

const params = activityRunParams({
  name: 'build',
  kind: 'code',
  owner: 'quality',
  description: 'Do the build work so there is something to resume past',
})

test(
  [
    'given use-cases/resume::skipIfDone',
    'when the activityRun is not in the completed set',
    'it should run the body and open an activity run row',
  ].join(', '),
  async () => {
    // given
    const run = runWith([])

    // when
    const actual = await skipIfDone(
      run,
      params,
      async () => 'ran',
      async () => 'replayed',
    )

    // then
    expect(actual).toEqual('ran')
    expect(run.activityRuns().map((activityRun) => activityRun.params.name)).toEqual(['build'])
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
    const run = runWith(['build'])

    // when
    const actual = await skipIfDone(
      run,
      params,
      async () => 'ran',
      async () => 'replayed',
    )

    // then
    expect(actual).toEqual('replayed')
    // recorded in THIS run's activityRuns, because `finish` judges the run by them:
    // a resumed chain that re-ran nothing was reported failed having done
    // everything asked of it
    expect(run.activityRuns().map((activityRun) => activityRun.status)).toEqual(['success'])
    expect(run.activityRuns()[0]?.activity_run_id).toContain('replayed')
  },
)
