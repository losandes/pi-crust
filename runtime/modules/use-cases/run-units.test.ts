import { afterEach, beforeEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { restoreTerminal, silenceTerminal } from '../testing/terminal-capture'
import { activityRunParams } from '../typedefs/activity-run'
import { crustConfigSchema } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import { EXIT } from '../typedefs/run-state'
import type { TActivity, TActivityContext } from '../typedefs/runnable-activity'
import type { TEventInput, TTracer } from '../typedefs/trace'
import type { TUnit } from '../typedefs/unit'
import { WARNING_EVENT } from '../typedefs/warning'
import { createRun } from './create-run'
import { observedPayload, PATHS_TOUCHED } from './observed-paths'
import { runUnits } from './run-activities'
import { finish } from './run-activity-run'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

/** Where this run's events land, so a test can read what it recorded. */
const EVENTS = new WeakMap<object, string>()

/**
 * `tracerOverride` lets a test wrap the real tracer — delegating to it for
 * everything except the one call it means to break — without copying this
 * fixture. Every test that calls `aRun()` with no argument gets exactly the
 * behaviour it always has.
 */
const aRun = (
  tracerOverride?: (tracer: TTracer) => TTracer,
  resume: ReadonlySet<string> = new Set<string>(),
): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-units-'))
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))
  const run = createRun({
    cfg: crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'runtime') },
      observability: { db: join(dir, 'crust.db') },
      agents: [],
    }),
    runId: 'aaaa1111',
    tracer: tracerOverride === undefined ? tracer : tracerOverride(tracer),
    engineer: 'tester',
    resume,
  })
  EVENTS.set(run, join(dir, 'events.jsonl'))

  return run
}

/**
 * `aRun()`'s workspace is its own scratch dir, resolved from `process.cwd()`
 * at creation -- ordinarily that IS the repository a test cares about, but a
 * handful of tests below build a SEPARATE git repository with `aRepo()` and
 * chdir into it only after `aRun()` already ran. Both roots are pinned to
 * that repository here, the way `createRun` would have resolved them had the
 * chdir happened first.
 */
const atRoot = (run: TRun, dir: string): TRun => {
  const next = { ...run, repoRoot: dir, vcsRoot: dir }
  // `eventsOf` keys off object identity, and the spread above makes a new
  // one -- so the events file this `run` already points at travels with it.
  const events = EVENTS.get(run)
  if (events !== undefined) {
    EVENTS.set(next, events)
  }

  return next
}

const eventsOf = (run: TRun): readonly Record<string, unknown>[] =>
  readFileSync(EVENTS.get(run) ?? '', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)

/** A activity that records when it started and finished, so overlap is observable. */
const timedActivity = (
  name: string,
  log: string[],
  delayMs: number,
): TActivity =>
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
  }) as unknown as TActivity

const contextFor = (run: TRun): TActivityContext =>
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
  }) as unknown as TActivityContext

const unit = (
  stage: string,
  strategy: 'serial' | 'concurrent',
  activities: readonly TActivity[],
): TUnit => ({ stage, strategy, activities, endsStage: true })

test(
  [
    'given use-cases/run-activities::runUnits',
    'when a stage is concurrent',
    'it should start the second activity before the first has finished',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('accept', 'concurrent', [
        timedActivity('review', log, 40),
        timedActivity('code-review', log, 5),
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
    'given use-cases/run-activities::runUnits',
    'when a stage is serial',
    'it should not start the second activity until the first has finished',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('implement', 'serial', [
        timedActivity('test', log, 20),
        timedActivity('build', log, 1),
      ]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })

    // then
    expect(log).toEqual(['test:start', 'test:end', 'build:start', 'build:end'])
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when a concurrent stage finishes',
    'it should carry every activity it ran forward as upstream, in declaration order',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('accept', 'concurrent', [
        timedActivity('review', log, 20),
        timedActivity('code-review', log, 1),
      ]),
    ]

    // when
    const actual = await runUnits({ run, units: given, start: contextFor(run) })

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'review',
      'code-review',
    ])
    expect(actual.outcomes.map((one) => one.activity)).toEqual([
      'review',
      'code-review',
    ])
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when a gate stops the run',
    'it should record what it did not reach as blocked, not as nothing at all',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('design', 'serial', [timedActivity('plan', log, 1)]),
      unit('implement', 'serial', [timedActivity('build', log, 1)]),
      unit('accept', 'serial', [timedActivity('review', log, 1)]),
    ]

    // when
    await runUnits({
      run,
      units: given,
      start: contextFor(run),
      approveAfter: ['plan'],
    })

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
    'given use-cases/run-activities::runUnits',
    'when an activity inside a concurrent stage is named in --approve-after',
    'it should let its siblings finish, then pause at the stage boundary',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const log: string[] = []
    const given = [
      unit('accept', 'concurrent', [
        timedActivity('review', log, 30),
        timedActivity('code-review', log, 1),
      ]),
      unit('deliver', 'serial', [timedActivity('commit', log, 1)]),
    ]

    // when
    await runUnits({
      run,
      units: given,
      start: contextFor(run),
      approveAfter: ['code-review'],
    })

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
    'given use-cases/run-activities::runUnits',
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
        activities: [timedActivity('plan', log, 1)],
        endsStage: false,
      },
      {
        stage: 'design',
        strategy: 'serial' as const,
        activities: [timedActivity('design', log, 1)],
        endsStage: true,
      },
      unit('implement', 'serial', [timedActivity('build', log, 1)]),
    ]

    // when
    await runUnits({
      run,
      units: given,
      start: contextFor(run),
      approveAfter: ['stage:design'],
    })

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
 * A activity with gates, whose envelope changes on the attempt it is told to
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
    /**
     * What this Activity Run is OBSERVED to change, as `executeAgent` records
     * it for a real agent. A commit is built from this and nothing else, so a
     * fixture that does not record it is a fixture that changed nothing.
     */
    touches?: readonly string[]
    /** what it CLAIMS it changed — a report, never the evidence */
    claims?: readonly string[]
    /** overrides the default no-op replay, for a resumed-instance test */
    replay?: TActivity['replay']
  }>,
): TActivity =>
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
    execute: (
      ctx: TActivityContext,
      handle: Readonly<{ activityRun: Readonly<{ activity_run_id: string }> }>,
    ) => {
      // biome-ignore lint/plugin/no-array-mutation: counting executions is the test
      params.runs.push(name)
      // biome-ignore lint/plugin/no-array-mutation: recording what it was told is the test
      params.feedbackSeen.push([...ctx.feedback])
      const summary = params.runs.length >= params.passOn ? 'green' : 'red'
      if (params.touches !== undefined) {
        ctx.run.tracer.event({
          run_id: ctx.run.runId,
          activity_run_id: handle.activityRun.activity_run_id,
          type: 'log',
          name: PATHS_TOUCHED,
          payload: observedPayload({
            activity: name,
            activityRunId: handle.activityRun.activity_run_id,
            agent: name,
            touched: params.touches,
            dirtyBefore: [],
            claimed: params.claims ?? params.touches,
          }),
        })
      }

      return Promise.resolve({
        previous: { status: 'success', summary },
        accepted: true,
      })
    },
    replay:
      params.replay ??
      (() => Promise.resolve({ previous: undefined, accepted: true })),
  }) as unknown as TActivity

test(
  [
    'given use-cases/run-activities::runUnits',
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
    expect(run.activityRuns().map((one) => one.status)).toEqual([
      'superseded',
      'success',
    ])
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
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
    'given use-cases/run-activities::runUnits',
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
        timedActivity('review', log, 20),
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
      (event) => event.type === 'activity_run_end' && event.name === 'review',
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
  // Signing is the operator's business, not this fixture's: a machine that
  // signs through an agent hangs a non-interactive `git commit` for a minute
  // and then fails, which reads as a broken test rather than a broken prompt.
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git('add', '-A')
  git('commit', '-qm', 'first')

  return dir
}

/**
 * Point this repository's commits at a hook that always refuses — the same
 * subprocess an unlocked signing agent fails in — without touching signing.
 */
const withFailingPreCommit = (dir: string): void => {
  const hooksDir = join(dir, '.hooks')
  mkdirSync(hooksDir, { recursive: true })
  const hook = join(hooksDir, 'pre-commit')
  writeFileSync(hook, '#!/bin/sh\necho "commit refused by hook" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  execFileSync('git', ['config', 'core.hooksPath', hooksDir], {
    cwd: dir,
    encoding: 'utf8',
  })
}

test(
  [
    'given use-cases/run-activities::runUnits',
    "when the first Activity's commit fails and a second Activity follows",
    'it should keep running the chain, with both Activity Runs successful',
  ].join(', '),
  async () => {
    /*
     * given — a commit git refuses (an unlocked signing agent, a hook that
     * exits non-zero) is a warning, never fatal: the work the first Activity
     * did is real, and the second Activity has nothing to do with the commit.
     */
    const dir = aRepo()
    withFailingPreCommit(dir)
    const run = atRoot(aRun(), dir)
    const firstRuns: string[] = []
    const secondRuns: string[] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs: firstRuns,
          feedbackSeen: [],
          passOn: 1,
          commit: true,
          touches: ['README.md'],
        }),
      ]),
      unit('accept', 'serial', [
        gatedStep('review', {
          runs: secondRuns,
          feedbackSeen: [],
          passOn: 1,
        }),
      ]),
    ]
    const was = process.cwd()
    process.chdir(dir)

    // when
    let result: unknown
    try {
      writeFileSync(join(dir, 'README.md'), 'after\n')
      result = await runUnits({ run, units: given, start: contextFor(run) })
    } finally {
      process.chdir(was)
    }

    // then — the chain resolved, the second Activity ran, nothing was committed
    expect(result).toBeDefined()
    expect(firstRuns).toEqual(['build'])
    expect(secondRuns).toEqual(['review'])
    expect(
      eventsOf(run).filter((event) => event.name === 'committed'),
    ).toHaveLength(0)
    expect(
      eventsOf(run).filter(
        (event) =>
          event.name === 'tree_warning' &&
          (event.payload as Readonly<{ kind?: string }>)?.kind ===
            'uncommitted',
      ),
    ).toHaveLength(1)
    const activityRuns = run.activityRuns()
    expect(activityRuns.every((one) => one.status === 'success')).toBe(true)

    // then — the developer's actual complaint: `just crust run` exits 0
    expect(
      eventsOf(run).filter((event) => event.name === 'committed'),
    ).toHaveLength(0)
    expect(finish(run)).toBe(EXIT.SUCCESS)
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when the trace write that files the uncommitted warning itself throws',
    'it should keep running the chain, with both Activity Runs successful',
  ].join(', '),
  async () => {
    /*
     * given — the same refused commit, but this time the failure is not
     * `commitPaths` (already settled) — it is filing the `uncommitted`
     * warning that reports it, standing in for a trace database a
     * concurrent run has locked past its own busy_timeout.
     */
    const dir = aRepo()
    withFailingPreCommit(dir)
    const run = atRoot(
      aRun((tracer) => ({
        ...tracer,
        event: (input: TEventInput): string => {
          if (input.name === WARNING_EVENT) {
            throw new Error('database is locked')
          }

          return tracer.event(input)
        },
      })),
      dir,
    )
    const firstRuns: string[] = []
    const secondRuns: string[] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs: firstRuns,
          feedbackSeen: [],
          passOn: 1,
          commit: true,
          touches: ['README.md'],
        }),
      ]),
      unit('accept', 'serial', [
        gatedStep('review', {
          runs: secondRuns,
          feedbackSeen: [],
          passOn: 1,
        }),
      ]),
    ]
    const was = process.cwd()
    process.chdir(dir)

    // when
    let result: unknown
    try {
      writeFileSync(join(dir, 'README.md'), 'after\n')
      result = await runUnits({ run, units: given, start: contextFor(run) })
    } finally {
      process.chdir(was)
    }

    // then — the chain resolved despite the trace write throwing, the second
    // Activity ran, and every Activity Run still reports success
    expect(result).toBeDefined()
    expect(firstRuns).toEqual(['build'])
    expect(secondRuns).toEqual(['review'])
    const activityRuns = run.activityRuns()
    expect(activityRuns.every((one) => one.status === 'success')).toBe(true)
    expect(finish(run)).toBe(EXIT.SUCCESS)
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when an Activity declares commit and its gates pass',
    'it should land its own change, and only after the gate ruled',
  ].join(', '),
  async () => {
    /*
     * given — delivery is a property of the Activity, not a mode of the
     * run: `--deliver branch|patch|commit` all committed the whole working
     * tree at the END of the chain, so a large body of work arrived squashed
     * whichever was chosen.
     */
    const dir = aRepo()
    const run = atRoot(aRun(), dir)
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 2,
          commit: true,
          touches: ['README.md'],
        }),
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

test(
  [
    'given use-cases/run-activities::runUnits',
    'when a file was dirty before the run and no Activity touched it',
    'it should be left dirty and uncommitted, because it is not the run’s',
  ].join(', '),
  async () => {
    /*
     * given — `git add -A` swept every uncommitted file in the repository
     * into the first Activity declaring `commit: true`, under a message
     * describing something else. A developer who commits before every run
     * never saw it; one who does not lost the ability to tell their work
     * from the factory's.
     */
    const dir = aRepo()
    const run = atRoot(aRun(), dir)
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 1,
          commit: true,
          touches: ['src.ts'],
        }),
      ]),
    ]
    const was = process.cwd()
    process.chdir(dir)

    // when — the developer's own edit is in the tree the whole time
    try {
      writeFileSync(join(dir, 'README.md'), 'mine, in progress\n')
      writeFileSync(join(dir, 'src.ts'), 'export const x = 1\n')
      await runUnits({ run, units: given, start: contextFor(run) })
    } finally {
      process.chdir(was)
    }

    // then — committed what the Activity wrote, and nothing else
    const committed = execFileSync(
      'git',
      ['show', '--name-only', '--pretty=format:', 'HEAD'],
      { cwd: dir, encoding: 'utf8' },
    ).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: dir,
      encoding: 'utf8',
    })
    expect(committed).toEqual('src.ts')
    expect(dirty).toContain('README.md')
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toEqual(
      'mine, in progress\n',
    )
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when an Activity wrote to a file that was already dirty',
    'it should commit it, and say which paths went in',
  ].join(', '),
  async () => {
    /*
     * given — refusing any file that was dirty before the run sounds safer
     * and is worse: a developer who starts a run to finish something they
     * began by hand would watch the Activity's own work go uncommitted. An
     * Activity may pull a dirty file into scope by WORKING on it; it may not
     * pull one in by running near it.
     */
    const dir = aRepo()
    const run = atRoot(aRun(), dir)
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 1,
          commit: true,
          touches: ['README.md'],
        }),
      ]),
    ]
    const was = process.cwd()
    process.chdir(dir)

    // when
    try {
      writeFileSync(join(dir, 'README.md'), 'started by hand, finished here\n')
      await runUnits({ run, units: given, start: contextFor(run) })
    } finally {
      process.chdir(was)
    }

    // then
    const committed = eventsOf(run).find((event) => event.name === 'committed')
      ?.payload as Readonly<{ paths: readonly string[] }> | undefined
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: dir,
        encoding: 'utf8',
      }),
    ).toEqual('')
    expect(committed?.paths).toEqual(['README.md'])
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when an Activity changed a path it never reported',
    'it should warn, spend no attempt, open no gate, and still succeed',
  ].join(', '),
  async () => {
    /*
     * given — the overwhelmingly common cause is a developer typing in their
     * own repository while the run works. A run that halted every time
     * somebody saved a file would be unusable in the tree they are in.
     */
    const run = aRun()
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 1,
          touches: ['src/add.ts'],
          claims: [],
        }),
      ]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })

    // then
    const warning = eventsOf(run).find((event) => event.name === 'tree_warning')
      ?.payload as Readonly<{ paths: readonly string[]; kind: string }>
    expect(warning).toMatchObject({ kind: 'unexpected', paths: ['src/add.ts'] })
    expect(runs).toEqual(['build'])
    expect(run.activityRuns().map((one) => one.status)).toEqual(['success'])
    expect(
      eventsOf(run).filter((event) => event.name === 'human_gate_open'),
    ).toHaveLength(0)
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when two Activities of one concurrent Stage both saw a path nobody claimed',
    'it should raise one warning for the Stage rather than one each',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('accept', 'concurrent', [
        gatedStep('review', {
          runs,
          feedbackSeen,
          passOn: 1,
          touches: ['notes.md'],
          claims: [],
        }),
        gatedStep('code-review', {
          runs,
          feedbackSeen,
          passOn: 1,
          touches: ['notes.md'],
          claims: [],
        }),
      ]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })

    // then
    const warnings = eventsOf(run).filter(
      (event) => event.name === 'tree_warning',
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.payload).toMatchObject({
      paths: ['notes.md'],
      activities: ['review', 'code-review'],
    })
  },
)

test(
  [
    'given use-cases/report-to-console::sessionFinished',
    'when a run raised a warning early and then kept going',
    'it should still say so when the last Activity has finished',
  ].join(', '),
  async () => {
    /*
     * given — a warning raised by the second of nine Activities is a line in
     * the middle of a long run, and nobody scrolls back to it.
     */
    const run = aRun()
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const log: string[] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 1,
          touches: ['src/add.ts'],
          claims: [],
        }),
      ]),
      unit('accept', 'serial', [timedActivity('review', log, 1)]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })
    run.console.sessionFinished(true, 0, 0, 'crust.db')

    // then
    const printed = eventsOf(run)
      .map((event) =>
        String(
          (event.payload as Readonly<{ message?: string }>)?.message ?? '',
        ),
      )
      .join('\n')
    expect(printed).toContain('1 unexplained change(s) during this run')
    expect(printed).toContain('src/add.ts')
    expect(printed).toContain('pi-crust cannot tell')
  },
)

/**
 * What a real resumed agent Activity's `replay` returns: the FAILING
 * envelope the previous process stored, not `{ previous: undefined }` —
 * that shape makes `settleGates` return early and judges nothing, which
 * would prove nothing about the retry this fixture exists to exercise.
 *
 * Counts its own calls and throws on the third, naming requirement 1.1.2:
 * with the fix, `replay` runs at most ONCE per instance for the life of the
 * run (`claimResume` spends the credit on the first call), so a regression
 * that lets a gate-triggered retry replay again fails fast with a readable
 * message instead of recursing until bun's test timeout kills the suite.
 */
const resumedReplay = (): Readonly<{
  fn: TActivity['replay']
  calls: () => number
}> => {
  let calls = 0
  const fn: TActivity['replay'] = () => {
    calls += 1
    if (calls >= 3) {
      throw new Error(
        'requirement 1.1.2: a gate-triggered retry must execute for real, ' +
          'not replay again',
      )
    }

    return Promise.resolve({
      previous: {
        status: 'success' as const,
        summary: 'red',
        artifacts: [],
        notes_for_next_agent: '',
      },
      accepted: true,
    })
  }

  return { fn, calls: () => calls }
}

test(
  [
    'given use-cases/run-activities::runUnits',
    "when a resumed Activity's replayed gate fails",
    'it should retry it for real, spending an attempt, until it passes (requirement 1.1.2)',
  ].join(', '),
  async () => {
    // given — 'build' already succeeded in an earlier process, but the
    // resumed envelope it replays back in fails the gate this time
    const replay = resumedReplay()
    const run = aRun(undefined, new Set(['build']))
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 1,
          replay: replay.fn,
        }),
      ]),
    ]

    // when
    await runUnits({ run, units: given, start: contextFor(run) })

    // then — the replay fires once, the retry executes for real exactly
    // once, and the fold completes with both rows on the record
    expect(replay.calls()).toEqual(1)
    expect(runs).toEqual(['build'])
    expect(run.activityRuns().map((one) => one.params.name)).toEqual([
      'build',
      'build',
    ])
    expect(run.activityRuns()[0]?.activity_run_id).toContain('replayed')
    expect(run.activityRuns()[1]?.status).toEqual('success')
  },
)

test(
  [
    'given use-cases/run-activities::runUnits',
    'when a resumed Activity keeps failing its gate on every real execution',
    'it should exhaust its attempts and stop the run (requirement 1.4.1)',
  ].join(', '),
  async () => {
    // given — the replayed envelope fails, and so does every real retry
    const replay = resumedReplay()
    const run = aRun(undefined, new Set(['build']))
    const runs: string[] = []
    const feedbackSeen: string[][] = []
    const given = [
      unit('implement', 'serial', [
        gatedStep('build', {
          runs,
          feedbackSeen,
          passOn: 99,
          attempts: 2,
          replay: replay.fn,
        }),
      ]),
    ]

    // when
    const actual = runUnits({ run, units: given, start: contextFor(run) })

    // then — the loop ends on the attempt ceiling rather than recursing
    // forever on an unspent, never-advancing budget
    await expect(actual).rejects.toThrow(/has no attempts left/)
    await actual.catch(() => undefined)
    expect(replay.calls()).toEqual(1)
    expect(runs).toHaveLength(2)
  },
)
