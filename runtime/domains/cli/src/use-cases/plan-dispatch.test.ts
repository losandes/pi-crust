import { expect, test } from 'bun:test'
import { devNull } from 'node:os'
import { planDispatch } from './plan-dispatch'
import { RECIPE_DOCS, type TRecipeDoc } from './recipe-docs'

const input = {
  env: {},
  cwd: '/repo/sub',
  packageRoot: '/pkg',
  repositoryRoot: '/repo',
}
const cases = [
  ['help', 'help', true, [], [], false],
  ['default', 'help', false, ['--commands'], [], false],
  ['init', '../../scripts/install', false, [], [], false],
  ['demo', 'demo', true, [], [], false],
  ['list', 'list', true, [], [], false],
  ['config', 'config', true, [], [], false],
  ['please', 'please', false, [], [], false],
  ['run', 'run', true, [], [], false],
  ['operator', 'operator', true, [], [], false],
  ['triage', 'triage', true, [], [], false],
  ['verify', 'verify', true, [], [], false],
  ['approve', 'approve', false, [], ['id'], false],
  ['reject', 'reject', false, [], ['id'], true],
  ['answer', 'answer', false, [], ['id'], true],
  ['resume', 'resume', false, [], ['id'], true],
  ['steer', 'steer', false, [], ['id', 'build'], true],
  ['ask', 'ask', false, [], ['id', 'build'], true],
  ['amend', 'amend', false, [], ['id', 'build'], true],
  ['join', 'join', false, [], ['id', 'build'], false],
  ['report', 'report', true, [], [], false],
  ['report-json', 'report', true, ['--json'], [], false],
  ['sessions', 'trace', true, ['sessions'], [], false],
  ['activity-runs', 'trace', true, ['activity-runs'], ['id'], false],
  ['tail', 'trace', true, ['tail'], ['id'], false],
  ['procs', 'trace', true, ['procs'], ['id'], false],
  ['observe', '../../scripts/observe', false, [], [], false],
  ['prune', 'prune', false, ['--older-than'], ['14d'], true],
  ['update', '../../scripts/install', false, ['--refresh'], [], false],
] as const

for (const [name, program, config, fixed, args, repeat] of cases) {
  test(
    [
      `given ${name}`,
      `when planned inside Git`,
      `it should preserve its invocation`,
    ].join(', '),
    () => {
      // given
      // when
      const actual = planDispatch(RECIPE_DOCS)({
        ...input,
        argv: [name, ...args],
      })
      // then
      expect(actual).toEqual({
        status: 'ok',
        data: {
          script: program.startsWith('../')
            ? `/pkg/scripts/${program.split('/').at(-1)}.ts`
            : `/pkg/runtime/commands/${program}.ts`,
          args: [
            ...(config ? ['--config', 'pi-crust.toml'] : []),
            ...fixed,
            ...(repeat ? args : []),
            ...args,
          ],
          cwd: '/repo',
        },
      })
    },
  )
}

for (const [argv, expected] of [
  [
    ['prune', '14d', '--yes'],
    ['--older-than', '14d', '14d', '--yes'],
  ],
  [
    ['report-json', '9d67c31f'],
    ['--config', 'pi-crust.toml', '--json', '9d67c31f'],
  ],
  [
    ['tail', '9d67c31f'],
    ['--config', 'pi-crust.toml', 'tail', '9d67c31f'],
  ],
  [
    ['ask', '9d67c31f', 'plan', 'why'],
    ['9d67c31f', 'plan', '9d67c31f', 'plan', 'why'],
  ],
  [[], ['--commands']],
] as const) {
  test(
    [
      `given ${argv.join(' ') || 'bare crust'}`,
      `when planned`,
      `it should match the worked example`,
    ].join(', '),
    () => {
      // given
      // when
      const actual = planDispatch(RECIPE_DOCS)({ ...input, argv })
      // then
      expect(actual.status === 'ok' && actual.data.args).toEqual(expected)
    },
  )
}

for (const [argv, message] of [
  [
    ['frobnicate'],
    'crust: unknown command "frobnicate". Run `crust help` to list the commands.',
  ],
  [
    ['approve'],
    'crust approve: missing <run-id>.\nusage: just crust approve <run-id>',
  ],
  [
    ['join', 'id'],
    'crust join: missing <activity>.\nusage: just crust join <run-id> <activity>',
  ],
  [
    ['default', 'two words'],
    'crust default: unexpected argument "two words".\nusage: just crust default  (same as the bare `just crust`)',
  ],
  [
    ['run'],
    'crust run: /repo/sub is not inside a Git repository. Run `git init` to create one, then `crust init` to set pi-crust up in it.',
  ],
] as const) {
  test(
    [
      `given ${argv.join(' ')}`,
      `when refused`,
      `it should explain the first failure`,
    ].join(', '),
    () => {
      // given
      // when
      const actual = planDispatch(RECIPE_DOCS)({
        ...input,
        repositoryRoot: undefined,
        argv,
      })
      // then
      expect(actual.status === 'error' && actual.error.message).toBe(message)
    },
  )
}

for (const [repositoryRoot, config] of [
  [undefined, devNull],
  ['/repo', 'conf/alt.toml'],
] as const) {
  test(
    [
      `given root ${repositoryRoot}`,
      `when listing`,
      `it should select the right config`,
    ].join(', '),
    () => {
      // given
      // when
      const result = planDispatch(RECIPE_DOCS)({
        ...input,
        repositoryRoot,
        env: { CRUST_CONFIG: '  conf/alt.toml  ' },
        argv: ['list'],
      })
      // then
      expect(result.status === 'ok' && result.data.args).toEqual([
        '--config',
        config,
      ])
    },
  )
}

test(
  [
    'given an injected probe',
    'when dispatched',
    'it should need only its definition',
  ].join(', '),
  () => {
    // given
    const probe: TRecipeDoc = {
      name: 'probe',
      group: 'getting started',
      summary: 'probe summary',
      usage: 'crust probe',
      flags: [],
      env: [],
      examples: [],
      run: {
        script: 'probe.ts',
        config: false,
        fixed: [],
        required: [],
        repeat: false,
        rest: false,
        repository: false,
      },
    }
    // when
    const result = planDispatch([probe])({ ...input, argv: ['probe'] })
    // then
    expect(result).toEqual({
      status: 'ok',
      data: { script: '/pkg/probe.ts', args: [], cwd: '/repo' },
    })
  },
)
