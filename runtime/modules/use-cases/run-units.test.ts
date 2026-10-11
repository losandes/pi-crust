import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { crustConfigSchema } from '../typedefs/config'
import { phaseParams } from '../typedefs/phase'
import type { TRun } from '../typedefs/run'
import type { TStep, TStepContext } from '../typedefs/step'
import type { TUnit } from '../typedefs/unit'
import { createRun } from './create-run'
import { runUnits } from './run-steps'

/** Where this run's events land, so a test can read what it recorded. */
const EVENTS = new WeakMap<object, string>()

const aRun = (): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-units-'))
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
  const run = createRun({
    cfg: crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'runtime') },
      observability: { db: join(dir, 'crust.db') },
      agents: [],
    }),
    runId: 'aaaa1111',
    tracer,
    engineer: 'tester',
    resume: new Set<string>(),
  })
  EVENTS.set(run, join(dir, 'events.jsonl'))

  return run
}

const eventsOf = (run: TRun): readonly Record<string, unknown>[] =>
  readFileSync(EVENTS.get(run) ?? '', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

/** A step that records when it started and finished, so overlap is observable. */
const timedStep = (
  name: string,
  log: string[],
  delayMs: number,
): TStep =>
  ({
    name,
    params: phaseParams({
      name,
      kind: 'code',
      owner: 'quality',
      description: `Run ${name} slowly enough to observe`,
    }),
    requires: [],
    execute: async () => {
      /*
       * Mutation is the measurement. Overlap is a fact about when things
       * happened, and the only way to observe it is for both activities to
       * write into one place as they go — a rebuilt array would record the
       * order this function returned in, which is the thing under test and
       * cannot also be the evidence.
       */
      // biome-ignore lint/plugin/no-array-mutation: recording interleaving is the test
      log.push(`${name}:start`)
      await new Promise((settle) => setTimeout(settle, delayMs))
      // biome-ignore lint/plugin/no-array-mutation: recording interleaving is the test
      log.push(`${name}:end`)

      return { previous: { status: 'success' }, accepted: true }
    },
    replay: () => Promise.resolve({ previous: undefined, accepted: true }),
  }) as unknown as TStep

const contextFor = (run: TRun): TStepContext =>
  ({
    run,
    prompt: 'x',
    previous: undefined,
    previousStep: undefined,
    upstream: [],
    cohort: [],
    baseline: '',
    outcomes: [],
  }) as unknown as TStepContext

const unit = (
  stage: string,
  strategy: 'serial' | 'concurrent',
  steps: readonly TStep[],
): TUnit => ({ stage, strategy, steps, endsStage: true })

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a stage is concurrent',
    'it should start the second activity before the first has finished',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('accept', 'concurrent', [
        timedStep('review', log, 40),
        timedStep('code-review', log, 5),
      ]),
    ]

    // when
    await runUnits(run, given, contextFor(run))

    // then
    expect(log).toEqual([
      'review:start',
      'code-review:start',
      'code-review:end',
      'review:end',
    ])
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a stage is serial',
    'it should not start the second activity until the first has finished',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('implement', 'serial', [
        timedStep('test', log, 20),
        timedStep('build', log, 1),
      ]),
    ]

    // when
    await runUnits(run, given, contextFor(run))

    // then
    expect(log).toEqual([
      'test:start',
      'test:end',
      'build:start',
      'build:end',
    ])
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a concurrent stage finishes',
    'it should carry every activity it ran forward as upstream, in declaration order',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('accept', 'concurrent', [
        timedStep('review', log, 20),
        timedStep('code-review', log, 1),
      ]),
    ]

    // when
    const actual = await runUnits(run, given, contextFor(run))

    // then
    expect(actual.upstream.map((one) => one.step)).toEqual([
      'review',
      'code-review',
    ])
    expect(actual.outcomes.map((one) => one.step)).toEqual([
      'review',
      'code-review',
    ])
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a gate stops the run',
    'it should record what it did not reach as blocked, not as nothing at all',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('design', 'serial', [timedStep('plan', log, 1)]),
      unit('implement', 'serial', [timedStep('build', log, 1)]),
      unit('accept', 'serial', [timedStep('review', log, 1)]),
    ]

    // when
    await runUnits(run, given, contextFor(run), ['plan'])

    // then
    expect(log).toEqual(['plan:start', 'plan:end'])
    const blocked = eventsOf(run).find(
      (event) => event.name === 'activities_blocked',
    )
    expect(blocked?.payload).toMatchObject({
      activities: ['build', 'review'],
      status: 'blocked',
    })
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when an activity inside a concurrent stage is named in --approve-after',
    'it should let its siblings finish, then pause at the stage boundary',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('accept', 'concurrent', [
        timedStep('review', log, 30),
        timedStep('code-review', log, 1),
      ]),
      unit('deliver', 'serial', [timedStep('commit', log, 1)]),
    ]

    // when
    await runUnits(run, given, contextFor(run), ['code-review'])

    // then
    expect(log).toEqual([
      'review:start',
      'code-review:start',
      'code-review:end',
      'review:end',
    ])
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a serial stage is named with the stage prefix',
    'it should pause after the whole stage, not after its first activity',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      {
        stage: 'design',
        strategy: 'serial' as const,
        steps: [timedStep('plan', log, 1)],
        endsStage: false,
      },
      {
        stage: 'design',
        strategy: 'serial' as const,
        steps: [timedStep('design', log, 1)],
        endsStage: true,
      },
      unit('implement', 'serial', [timedStep('build', log, 1)]),
    ]

    // when
    await runUnits(run, given, contextFor(run), ['stage:design'])

    // then
    expect(log).toEqual([
      'plan:start',
      'plan:end',
      'design:start',
      'design:end',
    ])
  },
)
