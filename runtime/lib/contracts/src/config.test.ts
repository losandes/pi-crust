import { expect, test } from 'bun:test'
import { crustConfigSchema, DEFAULT_POLL_MS, taskTriggerFaults } from './config'

for (const poll_ms of [0, -5, 2.5]) {
  test(
    [
      `given @SC19 a polling interval of ${poll_ms}`,
      'when parsing configuration',
      'it should reject non-positive or non-integer intervals',
    ].join(', '),
    () => {
      // given
      const document = { observability: { poll_ms } }
      // when
      const actual = crustConfigSchema.safeParse(document)
      // then
      expect(actual.success).toBe(false)
      expect(DEFAULT_POLL_MS).toBe(500)
    },
  )
}

for (const [trigger, expected] of [
  [{ on: 'change', skip: ['unknown'] }, ''],
  [{ before: 'builder' }, ''],
  [{ after: 'operator' }, ''],
  [{ before: 'missing' }, 'before = "missing"'],
  [{ after: 'missing' }, 'after = "missing"'],
  [{ before: 'gh-pull-request' }, 'on = "deliver"'],
] as const) {
  test(
    [
      `given a task trigger ${JSON.stringify(trigger)}`,
      'when validating references against the merged roster',
      'it should accept canonical names and aliases and explain invalid TOML references',
    ].join(', '),
    () => {
      // given
      const cfg = crustConfigSchema.parse({
        activities: [{ name: 'build', prompts: '.', aliases: ['builder'] }],
        planners: [{ name: 'operator', prompts: '.' }],
        tasks: { verify: { when: [trigger], run: 'true' } },
      })
      // when
      const actual = taskTriggerFaults(cfg)
      // then
      if (expected === '') expect(actual).toEqual([])
      else expect(actual.join('\n')).toContain(expected)
    },
  )
}

test(
  [
    'given no defined Activities and an invalid path policy',
    'when validating configuration',
    'it should name the absent roster and explain permitted policy verbs',
  ].join(', '),
  () => {
    // given
    const cfg = crustConfigSchema.parse({
      tasks: { verify: { when: [{ before: 'missing' }], run: 'true' } },
    })
    // when
    const faults = taskTriggerFaults(cfg)
    const invalid = crustConfigSchema.safeParse({
      defaults: { protected: { read: 'deny' } },
    })
    // then
    expect(faults.join('\n')).toContain('Defined Activities: (none)')
    expect(invalid.success).toBe(false)
    expect(invalid.error?.message).toContain('deny is not a path policy')
  },
)

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

test(
  [
    'given the configuration schema',
    'when observability defaults are parsed',
    'it should expose polling and ports without a database-location setting',
  ].join(', '),
  () => {
    // given
    const document = {}
    // when
    const actual = crustConfigSchema.parse(document).observability
    // then
    expect(Object.keys(actual).toSorted()).toEqual(['poll_ms', 'ports'])
  },
)
