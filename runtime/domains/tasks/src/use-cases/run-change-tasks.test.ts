import { expect, test } from 'bun:test'
import { crustConfigSchema } from '../../../../lib/contracts'
import type { TChangeTasksParams, TTaskPorts } from '../typedefs/task'
import { runChangeTasks, runTasks } from './run-change-tasks'
import { taskArtifactName } from './task-artifact-name'

test(
  [
    'given deliver tasks with a skip, multiple commands and a cwd',
    'when evaluating a whole-run contribution',
    'it should report skipped selections and reuse command execution and rebasing',
  ].join(', '),
  async () => {
    // given
    const { ports, params, events } = setup()
    const cfg = crustConfigSchema.parse({
      tasks: {
        skip: {
          when: [{ on: 'deliver', skip: ['build'] }],
          match: ['**/*.ts'],
          run: 'false',
        },
        verify: {
          when: [{ on: 'deliver' }],
          cwd: 'api',
          run: ['false', 'printf {{changed_paths}} {{base_ref}}'],
        },
        unmatched: {
          when: [{ on: 'deliver', skip: ['build'] }],
          match: ['*.md'],
          run: 'false',
        },
      },
    })
    // when
    const actual = await runTasks(ports)({
      ...params,
      cfg,
      moment: { kind: 'deliver' },
      contributions: [params.contributions[0]].filter(
        (entry) => entry !== undefined,
      ),
    })
    // then
    expect(actual.skipped).toEqual([
      { task: 'skip', instance: 'build_2', activity: 'build' },
    ])
    expect(
      actual.results.map((result) => [
        result.name,
        result.passed,
        result.commands.length,
      ]),
    ).toEqual([['verify', false, 2]])
    expect(
      events.some((event) =>
        event.includes('printf z.ts ../outside.ts old-ref'),
      ),
    ).toBe(true)
  },
)

const setup = () => {
  const cfg = crustConfigSchema.parse({
    task_config: { timeout_seconds: 7 },
    tasks: {
      'api:test': {
        when: [{ on: 'change' }],
        cwd: 'api',
        run: ['false', 'printf {{changed_paths}}', 'true'],
      },
      api_test: {
        when: [{ on: 'change' }],
        match: ['api/*.ts'],
        run: 'printf {{base_ref}}',
        timeout_seconds: 2,
      },
      skip: { when: [{ on: 'change', skip: ['build'] }], run: 'true' },
      none: { when: [{ on: 'change' }], match: ['*.md'], run: 'true' },
    },
  })
  const events: string[] = []
  const logs = new Map<string, string>()
  const ports: TTaskPorts = {
    exists: (path) => !path.endsWith('deleted.ts'),
    runShell: (spec) => {
      // biome-ignore lint/plugin/no-array-mutation: capture the shell call between start and end
      events.push(`${spec.cwd}:${spec.timeoutSeconds}:${spec.command}`)
      return Promise.resolve({
        returncode: spec.command === 'false' ? 1 : 0,
        timedOut: false,
        stdout: spec.command,
        stderr: '',
        durationSeconds: 0.125,
      })
    },
    writeArtifact: (path, text) => {
      logs.set(path, text)
    },
  }
  const params: TChangeTasksParams = {
    cfg,
    root: '/root',
    baseRef: 'old-ref',
    artifactFor: taskArtifactName,
    contributions: [
      {
        instance: 'build_2',
        activity: 'build',
        paths: ['api/z.ts', 'outside.ts', 'api/deleted.ts'],
      },
      {
        instance: 'revise',
        activity: 'build',
        paths: ['api/a.ts', 'api/z.ts'],
      },
    ],
    onCommandStart: ({ task }) => {
      // biome-ignore lint/plugin/no-array-mutation: capture the order of callbacks
      events.push(`start:${task}`)
    },
    onCommandEnd: ({ task, outputArtifact, result }) => {
      expect(logs.get(outputArtifact)).toContain(`$ ${result.command}\n`)
      // biome-ignore lint/plugin/no-array-mutation: capture the order of callbacks
      events.push(`end:${task}`)
    },
  }
  return { ports, params, events, logs }
}

test(
  [
    'given tasks matching two contributions, including overlapping and deleted paths',
    'when executing the change tasks',
    'it should run in order, retain failures, and write separate logs before recording completion',
  ].join(', '),
  async () => {
    // given
    const { ports, params, events, logs } = setup()
    // when
    const actual = await runChangeTasks(ports)(params)
    // then
    expect(actual.results.map(({ name, passed }) => [name, passed])).toEqual([
      ['api:test', false],
      ['api_test', true],
    ])
    expect(actual.existing).toEqual({ build_2: 2, revise: 2 })
    expect(actual.unmatched).toEqual({ build_2: [], revise: [] })
    expect(events).toEqual([
      'start:api:test',
      '/root/api:7:false',
      'end:api:test',
      'start:api:test',
      '/root/api:7:printf a.ts z.ts ../outside.ts',
      'end:api:test',
      'start:api:test',
      '/root/api:7:true',
      'end:api:test',
      'start:api_test',
      '/root:2:printf old-ref',
      'end:api_test',
    ])
    expect(logs.get('01_api_test.log')).toContain('duration_seconds: 0.125')
    expect(logs.get('02_api_test.log')).not.toContain('outside.ts')
  },
)

for (const successfulWrites of [0, 1]) {
  test(
    [
      `given an artifact write error after ${successfulWrites} completed commands`,
      'when evaluating the task',
      'it should reject by name and path and start no further commands',
    ].join(', '),
    async () => {
      // given
      const { ports, params, events, logs } = setup()
      const failing = {
        ...ports,
        writeArtifact: (path: string, text: string) => {
          if (logs.size === successfulWrites) throw new Error('disk full')
          ports.writeArtifact(path, text)
        },
      }
      // when, then
      await expect(runChangeTasks(failing)(params)).rejects.toThrow(
        'task api:test: cannot write 01_api_test.log: disk full',
      )
      expect(events.filter((line) => line.startsWith('start:'))).toHaveLength(
        successfulWrites + 1,
      )
      expect(events.filter((line) => line.startsWith('end:'))).toHaveLength(
        successfulWrites,
      )
    },
  )
}
