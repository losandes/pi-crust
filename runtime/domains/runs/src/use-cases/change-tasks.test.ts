import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TActivity, TActivityRun, TRun } from '../../../../lib/contracts'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import { liveTaskPorts, runChangeTasks } from '../../../tasks'
import { createTracer } from '../../../trace'
import { changeTasks, noteUnverified, recordTaskCommands } from './change-tasks'
import { createRun } from './create-run'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a nested workspace and a build repeat and revise owned by the same Activity',
    'when evaluating their tasks twice',
    'it should respect owner aliases, use Git-relative paths, and trace one task execution per evaluation in separate logs',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-task-boundary-'))
    const workspace = join(root, 'packages/app')
    const events = join(root, 'trace.jsonl')
    const tracer = createTracer(join(root, 'trace.db'), events)
    silenceTerminal()
    try {
      mkdirSync(workspace, { recursive: true })
      const run: TRun = {
        ...createRun({
          cfg: crustConfigSchema.parse({
            defaults: { data_dir: join(root, 'data') },
            activities: [
              {
                name: 'build',
                aliases: ['builder'],
                prompts: '.',
              },
            ],
            tasks: {
              suppressed: {
                when: [{ on: 'change', skip: ['builder'] }],
                run: 'false',
              },
              check: {
                when: [{ on: 'change' }],
                match: ['packages/app/*.ts'],
                cwd: 'packages/app',
                run: ["printf '%s\\n' {{changed_paths}}", 'true'],
              },
            },
          }),
          runId: 'nested11',
          tracer,
          engineer: 'tester',
        }),
        repoRoot: workspace,
        vcsRoot: root,
      }
      const activities = ['build_2', 'revise'].map(
        (instance, index): TActivity => {
          const params = activityRunParams({
            kind: 'agent',
            name: instance,
            owner: 'build',
            description: 'Fixture write.',
          })
          const id = `nested11_${instance}`
          const row: TActivityRun = {
            activity_run_id: id,
            run_id: run.runId,
            seq: index + 1,
            params,
            status: 'success',
            error: undefined,
            started_at: undefined,
            ended_at: undefined,
          }
          run.recordActivityRun(row)
          tracer.activityRunUpsert(row)
          const path = `${instance}.ts`
          writeFileSync(join(workspace, path), 'change')
          tracer.event({
            run_id: run.runId,
            activity_run_id: id,
            type: 'log',
            name: PATHS_TOUCHED,
            payload: observedPayload({
              activity: instance,
              activityRunId: id,
              agent: 'build',
              touched: [path],
              dirtyBefore: [],
              claimed: [path],
            }),
          })
          const done = () =>
            Promise.resolve({ previous: undefined, accepted: true })
          return {
            name: instance,
            instance,
            params,
            requires: [],
            gates: [],
            attempts: 1,
            commit: false,
            execute: done,
            replay: done,
          }
        },
      )
      // when
      const first = await changeTasks(run)(activities)
      const second = await changeTasks(run)(activities)
      // then
      expect([...first.entries()]).toEqual([...second.entries()])
      expect(first.get('build_2')).toEqual({ violations: [], unmatched: [] })
      expect(first.get('revise')).toEqual({ violations: [], unmatched: [] })
      expect(tracer.eventsNamed(run.runId, 'task:suppressed')).toEqual([])
      expect(tracer.eventsNamed(run.runId, 'tasks')).toHaveLength(4)
      expect(
        readdirSync(join(run.contextHandoffDir, 'tasks')).toSorted(),
      ).toEqual(['001', '002'])
      const commands = readFileSync(events, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((one) => one.name === 'task:check')
      expect(commands).toHaveLength(4)
      const lines = readFileSync(events, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const starts = lines.filter((one) => one.name === 'task_start')
      const ends = lines.filter((one) => one.name === 'task_end')
      expect(starts).toHaveLength(2)
      expect(ends).toHaveLength(2)
      expect(new Set(starts.map((one) => one.payload.execution)).size).toBe(2)
      for (const [index, start] of starts.entries()) {
        const end = ends[index]
        const firstCommand = commands[index * 2]
        expect(start).toMatchObject({
          type: 'log',
          activity_run_id: firstCommand.activity_run_id,
          payload: { task: 'check', moment: 'change' },
        })
        expect(end).toMatchObject({
          type: 'log',
          activity_run_id: start.activity_run_id,
          started_at: start.started_at,
          ended_at: commands[index * 2 + 1].ended_at,
          payload: {
            execution: start.payload.execution,
            passed: true,
            moment: 'change',
          },
        })
        expect(
          Date.parse(start.started_at) - Date.parse(firstCommand.started_at),
        ).toBeGreaterThanOrEqual(0)
        expect(
          Date.parse(start.started_at) - Date.parse(firstCommand.started_at),
        ).toBeLessThanOrEqual(1000)
        expect(lines.indexOf(start)).toBeLessThan(
          lines.findIndex((line) => line.event_id === firstCommand.event_id),
        )
        expect(lines.indexOf(end)).toBeGreaterThan(
          lines.findIndex(
            (line) => line.event_id === commands[index * 2 + 1].event_id,
          ),
        )
      }
      expect(
        [...starts, ...ends].some((one) => one.payload.task === 'suppressed'),
      ).toBe(false)
      expect(commands[0]).toMatchObject({
        type: 'tool_call',
        activity_run_id: 'nested11_build_2',
        payload: {
          task: 'check',
          returncode: 0,
          passed: true,
          timed_out: false,
          instances: ['build_2', 'revise'],
        },
      })
      expect(
        readFileSync(
          join(run.contextHandoffDir, 'tasks/001/02_check.log'),
          'utf8',
        ),
      ).toContain('--- stdout ---\nbuild_2.ts\nrevise.ts\n')
    } finally {
      restoreTerminal()
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a two-command task whose first command fails and unverified paths',
    'when recording task completion and tree warnings',
    'it should finish the failed task after both commands and record only non-empty warnings',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-task-lifecycle-'))
    const tracer = createTracer(
      join(root, 'trace.db'),
      join(root, 'events.jsonl'),
    )
    silenceTerminal()
    try {
      const run = createRun({
        cfg: crustConfigSchema.parse({
          defaults: { data_dir: join(root, 'data') },
          tasks: {
            check: { when: [{ on: 'change' }], run: ['false', 'true'] },
          },
        }),
        runId: 'lifecycle',
        tracer,
        engineer: 'tester',
      })
      const hooks = recordTaskCommands(run, { findRow: () => undefined })
      writeFileSync(join(root, 'a.ts'), 'change')
      // when
      const outcome = await runChangeTasks(liveTaskPorts)({
        cfg: run.cfg,
        root,
        baseRef: '',
        contributions: [
          { instance: 'build', activity: undefined, paths: ['a.ts'] },
        ],
        artifactFor: () => join(root, 'output.log'),
        ...hooks,
      })
      noteUnverified(run, 'implement')('build', ['a.ts'])
      noteUnverified(run, 'implement')('build', [])
      // then
      expect(outcome.results[0]?.commands.map((one) => one.passed)).toEqual([
        false,
        true,
      ])
      expect(tracer.eventsNamed(run.runId, 'task_end')).toMatchObject([
        { task: 'check', passed: false },
      ])
      expect(tracer.eventsNamed(run.runId, 'tree_warning')).toMatchObject([
        { kind: 'unverified', paths: ['a.ts'] },
      ])
      expect(tracer.eventsNamed(run.runId, 'tree_warning')).toHaveLength(1)
    } finally {
      restoreTerminal()
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
)
