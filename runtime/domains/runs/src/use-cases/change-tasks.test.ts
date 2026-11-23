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
import { createTracer } from '../../../trace'
import { changeTasks } from './change-tasks'
import { createRun } from './create-run'

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a nested workspace and a build repeat and revise owned by the same Activity',
    'when evaluating their tasks twice',
    'it should respect owner aliases, use Git-relative paths, and trace one command per evaluation in separate logs',
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
                prompts: { system: 'system.md', user: 'user.md' },
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
                run: "printf '%s\\n' {{changed_paths}}",
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
      expect(commands).toHaveLength(2)
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
