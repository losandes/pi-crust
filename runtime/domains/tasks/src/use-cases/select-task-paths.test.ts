import { expect, test } from 'bun:test'
import { activityConfigSchema, taskSchema } from '../../../../lib/contracts'
import { existingTaskPaths, selectTaskPaths } from './select-task-paths'

test(
  [
    'given a task with an alias in its skip list and paths including a deletion',
    'when selecting paths for multiple instances',
    'it should exclude the skipped canonical Activity, deleted files and nonmatching paths',
  ].join(', '),
  () => {
    // given
    const activities = [
      activityConfigSchema.parse({
        name: 'diagnose',
        aliases: ['debug'],
        prompts: { system: 'system.md', user: 'user.md' },
      }),
    ]
    const task = taskSchema.parse({
      when: [{ on: 'change', skip: ['debug', 'unknown'] }],
      match: ['*.ts'],
      run: 'true',
    })
    const paths = ['a.ts', 'deleted.ts', 'nested/b.ts', 'c.md']
    const existing = existingTaskPaths(
      { exists: (path) => path !== '/root/deleted.ts' },
      '/root',
    )
    // when
    const select = selectTaskPaths(activities, existing, task)
    // then
    expect(
      select({ instance: 'diagnose_2', activity: 'diagnose', paths }),
    ).toEqual([])
    expect(select({ instance: 'build', activity: 'build', paths })).toEqual([
      'a.ts',
    ])
    expect(
      select({ instance: 'working tree', activity: undefined, paths }),
    ).toEqual(['a.ts'])
  },
)
