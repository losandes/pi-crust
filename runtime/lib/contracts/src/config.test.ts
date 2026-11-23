import { expect, test } from 'bun:test'
import { crustConfigSchema } from './config'

const task = { when: [{ on: 'change' }], run: 'true' }

for (const [name, input] of [
  ['2', task],
  ['10', task],
  ['lint', { ...task, unknown: true }],
  ['lint', { run: 'true' }],
  ['lint', { ...task, when: [] }],
  ['lint', { ...task, when: [...task.when, ...task.when] }],
  ['lint', { ...task, when: [{ on: 'deliver' }] }],
  ['lint', { ...task, run: [] }],
  ['lint', { ...task, run: '' }],
  ['lint', { ...task, run: ['true', ''] }],
  ['lint', { ...task, cwd: '/absolute' }],
  ['lint', { ...task, cwd: 'a/../b' }],
  ['lint', { ...task, run: "printf '%s {{base_ref}}'" }],
  ['lint', { ...task, timeout_seconds: 0 }],
] as const) {
  test(
    [
      `given task ${name} with ${JSON.stringify(input)}`,
      'when validating configuration',
      'it should reject the task by name',
    ].join(', '),
    () => {
      // given
      const config = { tasks: { [name]: input } }
      // when
      const parsed = crustConfigSchema.safeParse(config)
      // then
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues[0]?.path).toEqual(
        expect.arrayContaining(['tasks', name]),
      )
    },
  )
}

test(
  [
    'given tasks in non-alphabetical order',
    'when loading them without optional settings',
    'it should preserve declaration order and apply defaults',
  ].join(', '),
  () => {
    // given
    const tasks = { zeta: task, alpha: task, m10: task }
    // when
    const actual = crustConfigSchema.parse({ tasks })
    // then
    expect(Object.keys(actual.tasks)).toEqual(['zeta', 'alpha', 'm10'])
    expect(actual.task_config).toEqual({ timeout_seconds: 300 })
    expect(actual.tasks.zeta).toEqual({
      ...task,
      cwd: '',
      match: [],
      when: [{ on: 'change', skip: [] }],
    })
  },
)
