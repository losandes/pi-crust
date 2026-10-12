import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { crustConfigSchema } from '../typedefs/config'
import { activityRunParams } from '../typedefs/activity-run'
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
    params: activityRunParams({
      name,
      kind: 'code',
      owner: 'quality',
      description: `Run ${name} slowly enough to observe`,
    }),
    requires: [],
    instance: name,
    gates: [],
    attempts: 2,
    commit: false,
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
    feedback: [],
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
    await runUnits({ run, units: given, start: contextFor(run) })

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
    await runUnits({ run, units: given, start: contextFor(run) })

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
    const actual = await runUnits({ run, units: given, start: contextFor(run) })

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
    await runUnits({ run, units: given, start: contextFor(run), approveAfter: ['plan'] })

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
    await runUnits({ run, units: given, start: contextFor(run), approveAfter: ['code-review'] })

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
    await runUnits({ run, units: given, start: contextFor(run), approveAfter: ['stage:design'] })

    // then
    expect(log).toEqual([
      'plan:start',
      'plan:end',
      'design:start',
      'design:end',
    ])
  },
)

/**
 * A step with gates, whose envelope changes on the attempt it is told to
 * pass on.
 *
 * `runs` records every execution, so "an attempt IS an Activity Run" is
 * observable rather than asserted.
 */
const gatedStep = (
  name: string,
  params: Readonly<{
    runs: string[]
    feedbackSeen: string[][]
    passOn: number
    attempts?: number
    commit?: boolean
  }>,
): TStep =>
  ({
    name,
    instance: name,
    params: activityRunParams({
      name,
      kind: 'agent',
      owner: name,
      description: `Run ${name} and let a gate rule on what it produced`,
    }),
    requires: [name],
    gates: [
      {
        name: 'checks',
        check: (envelope: Readonly<{ summary: string }>) =>
          envelope.summary === 'green'
            ? { checks: [{ item: 'suite', ok: true, note: 'exit 0' }] }
            : { checks: [{ item: 'suite', ok: false, note: 'exit 1' }] },
      },
    ],
    attempts: params.attempts ?? 2,
    commit: params.commit ?? false,
    execute: (ctx: TStepContext) => {
      // biome-ignore lint/plugin/no-array-mutation: counting executions is the test
      params.runs.push(name)
      // biome-ignore lint/plugin/no-array-mutation: recording what it was told is the test
      params.feedbackSeen.push([...ctx.feedback])
      const summary = params.runs.length >= params.passOn ? 'green' : 'red'

      return Promise.resolve({
        previous: { status: 'success', summary },
        accepted: true,
      })
    },
    replay: () => Promise.resolve({ previous: undefined, accepted: true }),
  }) as unknown as TStep

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a gate fails and the instance has budget left',
    'it should run the Activity again as its own Activity Run, with the violations in hand',
  ].join(', '),
  async () => {
    /*
     * given — a gate-failure retry used to increment a column on the
     * existing row, which is why a budget counting Activity Runs would have
     * missed gate failures entirely: the case it most obviously governs.
     */
    const run = aRun()
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', { runs, feedbackSeen, passOn: 2 }),
      ]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })

    // then — two executions, two rows, and the second was told why
    expect(runs).toEqual(['build', 'build'])
    expect(feedbackSeen[1]).toEqual(['suite: exit 1'])
    expect(
      run.activityRuns().filter((one) => one.params.name === 'build'),
    ).toHaveLength(2)
    expect(
      run.activityRuns().map((one) => one.status),
    ).toEqual(['superseded', 'success'])
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a gate fails and the instance has spent its budget',
    'it should stop the run and report every cause the budget went on',
  ].join(', '),
  async () => {
    // given — one number explains nothing to the person being asked
    const run = aRun()
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', { runs, feedbackSeen, passOn: 99, attempts: 2 }),
      ]),
    ]

    // when
    const actual = runUnits({ run, units: given, start: contextFor(run) })

    // then
    expect(actual).rejects.toThrow(/has spent all 2 attempt\(s\) this run/)
    await actual.catch(() => undefined)
    expect(runs).toHaveLength(2)
  },
)

test(
  [
    'given use-cases/run-steps::runUnits',
    'when a concurrent stage holds a gate that reads the working tree',
    'it should judge it at the stage boundary, once no sibling is still writing',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('accept', 'concurrent', [
        gatedStep('build', { runs, feedbackSeen, passOn: 1 }),
        timedStep('review', log, 20),
      ]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })

    // then — the sibling had finished before the gate ran
    const names = run.activityRuns().map((one) => one.params.name)
    const gatePassed = eventsOf(run).findIndex(
      (event) => event.name === 'checks' && event.type === 'gate_pass',
    )
    const siblingEnded = eventsOf(run).findIndex(
      (event) =>
        event.type === 'activity_run_end' && event.name === 'review',
    )
    expect(names).toEqual(['build', 'review'])
    expect(gatePassed).toBeGreaterThan(siblingEnded)
  },
)

/** A repository with one commit, so a second one can be told from the first. */
const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-units-repo-'))
  const git = (...args: readonly string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'tester@example.com')
  git('config', 'user.name', 'tester')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git('add', '-A')
  git('commit', '-qm', 'first')

  return dir
}

test(
  [
    'given use-cases/run-steps::runUnits',
    'when an Activity declares commit and its gates pass',
    'it should land its own change, and only after the gate ruled',
  ].join(', '),
  async () => {
    /*
     * given — delivery is a property of the Activity, not a mode of the
     * run: `--deliver branch|patch|commit` all performed one `commitAll` at
     * the END of the chain, so a large body of work arrived squashed
     * whichever was chosen.
     */
    const dir = aRepo()
    const run = aRun()
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', { runs, feedbackSeen, passOn: 2, commit: true }),
      ]),
    ]
    const was = process.cwd()
    process.chdir(dir)

    // when — the first attempt fails its gate, the second passes
    try {
      writeFileSync(join(dir, 'README.md'), 'after\n')
      await runUnits({ run, units: given, start: contextFor(run) })
    } finally {
      process.chdir(was)
    }

    // then — one commit, after the retry, not one per attempt
    const log = execFileSync('git', ['log', '--oneline'], {
      cwd: dir,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
    expect(runs).toHaveLength(2)
    expect(log).toHaveLength(2)
    expect(
      eventsOf(run).filter((event) => event.name === 'committed'),
    ).toHaveLength(1)
  },
)
