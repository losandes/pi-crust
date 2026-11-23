import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivity,
  TActivityContext,
  TRun,
  TUnit,
} from '../../../../lib/contracts'
import {
  activityRunParams,
  crustConfigSchema,
  genericOutput,
  WARNING_EVENT,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { observedPayload, PATHS_TOUCHED, RUN_START } from '../../../policy'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { runUnits } from './run-activities'

const fixture = async (
  body: (run: TRun) => Promise<void>,
  resume: readonly string[] = [],
) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-change-round-'))
  const tracer = createTracer(
    join(root, 'trace.db'),
    join(root, 'events.jsonl'),
  )
  silenceTerminal()
  try {
    const run = {
      ...createRun({
        cfg: crustConfigSchema.parse({
          defaults: { data_dir: join(root, 'data') },
          tasks: {
            check: {
              when: [{ on: 'change' }],
              match: ['*.ts'],
              run: "printf '%s\\n' {{base_ref}} {{changed_paths}}; test ! -f fail",
            },
          },
        }),
        runId: 'tasks111',
        tracer,
        engineer: 'tester',
        resume: new Set(resume),
      }),
      repoRoot: root,
      vcsRoot: root,
    }
    tracer.event({
      run_id: run.runId,
      type: 'log',
      name: RUN_START,
      payload: { head: 'recorded-start', tree: {} },
    })
    await body(run)
  } finally {
    restoreTerminal()
    tracer.close()
    rmSync(root, { recursive: true, force: true })
  }
}

const context = (run: TRun): TActivityContext => ({
  run,
  prompt: '',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})

const observe = (
  run: TRun,
  instance: string,
  id: string,
  paths: readonly string[],
) => {
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: id,
    type: 'log',
    name: PATHS_TOUCHED,
    payload: observedPayload({
      activity: instance,
      activityRunId: id,
      agent: instance,
      touched: paths,
      dirtyBefore: [],
      claimed: paths,
    }),
  })
}

const writer = (
  name: string,
  paths: (feedback: readonly string[]) => readonly string[],
  attempts = 2,
): TActivity => ({
  name,
  instance: name,
  params: activityRunParams({
    name,
    kind: 'agent',
    owner: name,
    description: 'Write a fixture change.',
  }),
  requires: [],
  gates: [],
  attempts,
  commit: false,
  execute: ({ run, feedback }, handle) => {
    const touched = paths(feedback)
    for (const path of touched)
      writeFileSync(join(run.repoRoot, path), 'change')
    observe(run, name, handle.activityRun.activity_run_id, touched)
    return Promise.resolve({ previous: undefined, accepted: true })
  },
  replay: () => Promise.resolve({ previous: undefined, accepted: true }),
})

const started = (run: TRun) => run.tracer.eventsNamed(run.runId, 'task:check')
const execute = (
  run: TRun,
  activities: readonly TActivity[],
  strategy: TUnit['strategy'],
) =>
  runUnits({
    run,
    units: [{ stage: 'implement', endsStage: true, activities, strategy }],
    start: context(run),
  })

test.skipIf(SKIP_INTEGRATION)(
  [
    'given concurrent writers with no output gates and a task that fails once',
    'when settling the stage',
    'it should select both sibling paths once, retry only the matched writers, and include paths from both attempts',
  ].join(', '),
  async () => {
    // given
    await fixture(async (run) => {
      writeFileSync(join(run.repoRoot, 'fail'), '')
      const feedbackSeen: (readonly string[])[] = []
      const writers = [
        writer('first', (feedback) => {
          // biome-ignore lint/plugin/no-array-mutation: capture feedback in attempt order
          feedbackSeen.push(feedback)
          if (feedback.length === 0) return ['a.ts']
          rmSync(join(run.repoRoot, 'fail'), { force: true })
          return ['b.ts']
        }),
        writer('second', () => ['c.ts']),
        writer('docs', () => ['docs.md']),
      ]
      // when
      await execute(run, writers, 'concurrent')
      // then
      const events = started(run)
      expect(
        events.map(({ instances, passed }) => ({ instances, passed })),
      ).toEqual([
        { instances: ['first', 'second'], passed: false },
        { instances: ['first', 'second'], passed: true },
      ])
      expect(events[0]?.command).toContain('recorded-start a.ts c.ts')
      expect(events[1]?.command).toContain('recorded-start a.ts b.ts c.ts')
      expect(feedbackSeen[1]?.[0]).toMatch(/^task check: .* exited 1/)
      expect(
        run.activityRuns().map(({ params, status }) => [params.name, status]),
      ).toEqual([
        ['first', 'superseded'],
        ['second', 'superseded'],
        ['docs', 'success'],
        ['first', 'success'],
        ['second', 'success'],
      ])
      expect(
        run.tracer
          .eventsNamed(run.runId, WARNING_EVENT)
          .filter(({ kind }) => kind === 'unverified'),
      ).toHaveLength(1)
      expect(
        readdirSync(join(run.contextHandoffDir, 'tasks')).toSorted(),
      ).toEqual(['001', '002'])
      expect(
        readFileSync(
          join(run.contextHandoffDir, 'tasks/002/01_check.log'),
          'utf8',
        ),
      ).toContain('a.ts\nb.ts\nc.ts\n')
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a replayed Activity with a recorded matching path',
    'when settling a resumed unit',
    'it should re-evaluate its matching tasks without executing the Activity',
  ].join(', '),
  async () => {
    // given
    await fixture(
      async (run) => {
        writeFileSync(join(run.repoRoot, 'a.ts'), 'prior')
        observe(run, 'build', '', ['a.ts'])
        // when
        await execute(
          run,
          [
            writer('build', () => {
              throw new Error('must replay')
            }),
          ],
          'serial',
        )
        // then
        expect(started(run)).toHaveLength(1)
        expect(started(run)[0]).toMatchObject({
          instances: ['build'],
          passed: true,
        })
      },
      ['build'],
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a task failure and an Activity with one attempt and no output gates',
    'when settling the unit',
    'it should fail with the task feedback after exhausting the attempt',
  ].join(', '),
  async () => {
    // given
    await fixture(async (run) => {
      writeFileSync(join(run.repoRoot, 'fail'), '')
      // when, then
      await expect(
        execute(run, [writer('build', () => ['a.ts'], 1)], 'serial'),
      ).rejects.toThrow(
        'build failed its gates and has no attempts left:\n- task check:',
      )
      expect(run.activityRuns()[0]?.status).toBe('fail')
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an output check and a repository task that fail on the same attempt',
    'when settling the unit',
    'it should report both failures in order and spend just one retry',
  ].join(', '),
  async () => {
    // given
    await fixture(async (run) => {
      writeFileSync(join(run.repoRoot, 'fail'), '')
      const feedbackSeen: (readonly string[])[] = []
      const base = writer('build', (feedback) => {
        // biome-ignore lint/plugin/no-array-mutation: capture each attempt's feedback
        feedbackSeen.push(feedback)
        if (feedback.length > 0)
          rmSync(join(run.repoRoot, 'fail'), { force: true })
        return ['a.ts']
      })
      const step: TActivity = {
        ...base,
        gates: [
          {
            name: 'output',
            check: () => ({
              checks: [
                {
                  item: 'output evidence',
                  ok: feedbackSeen.length > 1,
                  note: 'missing',
                },
              ],
            }),
          },
        ],
        execute: async (ctx, handle) => ({
          ...(await base.execute(ctx, handle)),
          previous: genericOutput.schema.parse({
            status: 'success',
            summary: 'Finished fixture',
          }),
        }),
      }
      // when
      await execute(run, [step], 'serial')
      // then
      expect(feedbackSeen).toHaveLength(2)
      expect(feedbackSeen[1]).toEqual([
        'output evidence: missing',
        expect.stringMatching(/^task check: .* exited 1/),
      ])
      expect(started(run)).toHaveLength(2)
    })
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a writer requesting a commit and a matching change task',
    'when the output check and task both pass',
    'it should record the task result before committing the Activity work',
  ].join(', '),
  async () => {
    // given
    await fixture(async (run) => {
      const git = (...args: readonly string[]) =>
        execFileSync('git', args, {
          cwd: run.repoRoot,
          encoding: 'utf8',
        }).trim()
      git('init', '-q')
      git('config', 'user.name', 'tester')
      git('config', 'user.email', 'tester@example.com')
      git('config', 'commit.gpgsign', 'false')
      git('commit', '-qm', 'initial', '--allow-empty')
      const base = writer('build', () => ['committed.ts'])
      const step: TActivity = {
        ...base,
        commit: true,
        gates: [
          {
            name: 'output',
            check: () => ({
              checks: [{ item: 'output evidence', ok: true, note: 'present' }],
            }),
          },
        ],
        execute: async (ctx, handle) => ({
          ...(await base.execute(ctx, handle)),
          previous: genericOutput.schema.parse({
            status: 'success',
            summary: 'Fixture commit',
          }),
        }),
      }
      // when
      await execute(run, [step], 'serial')
      // then
      const names = readFileSync(join(run.repoRoot, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).name)
      expect(names.indexOf('task:check')).toBeGreaterThan(
        names.indexOf('output'),
      )
      expect(names.indexOf('committed')).toBeGreaterThan(
        names.indexOf('task:check'),
      )
      expect(git('show', 'HEAD:committed.ts')).toBe('change')
    })
  },
)
