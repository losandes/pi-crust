import { expect, test } from 'bun:test'
import { crustConfigSchema } from './config'

const task = { when: [{ on: 'change' }], run: 'true' }

test(
  [
    'given all four triggers on one task',
    'when parsing its schema',
    'it should accept distinct moments and default only on skip lists',
  ].join(', '),
  () => {
    // given
    const when = [
      { on: 'change' },
      { on: 'deliver' },
      { before: 'build' },
      { after: 'build' },
    ]
    // when
    const actual = crustConfigSchema.parse({
      tasks: { verify: { when, run: 'true' } },
    })
    // then
    expect(actual.tasks.verify?.when).toEqual([
      { on: 'change', skip: [] },
      { on: 'deliver', skip: [] },
      { before: 'build' },
      { after: 'build' },
    ])
  },
)

for (const [name, input] of [
  ['2', task],
  ['10', task],
  ['lint', { ...task, unknown: true }],
  ['lint', { run: 'true' }],
  ['lint', { ...task, when: [] }],
  ['lint', { ...task, when: [...task.when, ...task.when] }],
  ['lint', { ...task, when: [{ on: 'unknown' }] }],
  ['lint', { ...task, when: [{ before: 'build', skip: [] }] }],
  ['lint', { ...task, when: [{ after: 'build', on: 'deliver' }] }],
  ['lint', { ...task, when: [{ before: '' }] }],
  ['lint', { ...task, when: [{ after: 'build' }, { after: 'build' }] }],
  ['lint', { ...task, when: [{ before: 'build' }, { before: 'build' }] }],
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
