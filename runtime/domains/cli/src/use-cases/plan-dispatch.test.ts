import { expect, test } from 'bun:test'
import { devNull } from 'node:os'
import { parseCli } from './parse-cli'
import { planDispatch } from './plan-dispatch'
import { RECIPE_DOCS, type TRecipeDoc } from './recipe-docs'
import { dispatchArgv, recipeArgv } from './recipe-line'
import { resumeArgv } from './resume-run'

const input = {
  env: {},
  cwd: '/repo/sub',
  packageRoot: '/pkg',
  repositoryRoot: '/repo',
}
const lifecycleNames = ['gh-issue', 'ship', 'ship-plan', 'ship-outcome']

for (const name of lifecycleNames) {
  for (const typed of [
    ['add a /health endpoint'],
    ['path/to/prompt.md', '--name', 'health endpoint'],
    [
      'x',
      '-id',
      'a1b2c3d4',
      '-r',
      '-m',
      'build=@high',
      '-c',
      'false',
      '-n',
      'label',
    ],
    ['x', '--lifecycle', name],
  ]) {
    test(
      [
        `given ${name} ${typed.join(' ')}`,
        'when dispatched',
        'it should pin the lifecycle and preserve typed arguments',
      ].join(', '),
      () => {
        // given
        // when
        const actual = planDispatch(RECIPE_DOCS)({
          ...input,
          argv: [name, ...typed],
        })
        // then
        expect(actual).toEqual({
          status: 'ok',
          data: {
            script: '/pkg/runtime/commands/run.ts',
            args: ['--config', 'pi-crust.toml', '--lifecycle', name, ...typed],
            cwd: '/repo',
          },
        })
      },
    )
  }

  test(
    [
      `given ${name} with every run option`,
      'when compared with the long form',
      'it should parse to the same run',
    ].join(', '),
    () => {
      // given
      const typed = [
        'do something',
        '--run-id',
        'a1b2c3d4',
        '--resume',
        '--scope',
        'main...HEAD',
        '--approve-after',
        'plan',
        '--model',
        'build=@high',
        '--commit',
        'false',
        '--trust-level',
        '50',
        '--handoff',
        'specs/{session_id}',
        '--name',
        'label',
        '--stream',
        '--config',
        'alt.toml',
      ]
      // when
      const short = planDispatch(RECIPE_DOCS)({
        ...input,
        argv: [name, ...typed],
      })
      const long = planDispatch(RECIPE_DOCS)({
        ...input,
        argv: ['run', ...typed, '--lifecycle', name],
      })
      // then
      expect(short.status).toBe('ok')
      expect(long.status).toBe('ok')
      if (short.status !== 'ok' || long.status !== 'ok') return
      expect(short.data.script).toBe(long.data.script)
      expect(parseCli(short.data.args)).toEqual(parseCli(long.data.args))
    },
  )

  for (const typed of [[], ['--stream']]) {
    test(
      [
        `given ${name} ${typed.join(' ')} without a prompt`,
        'when dispatched inside Git',
        'it should explain the required prompt using the typed command',
      ].join(', '),
      () => {
        // given
        // when
        const actual = planDispatch(RECIPE_DOCS)({
          ...input,
          argv: [name, ...typed],
        })
        // then
        expect(actual.status).toBe('error')
        if (actual.status !== 'error') return
        expect(
          actual.error.message.startsWith(
            `a prompt is required\nusage: crust ${name} "`,
          ),
        ).toBe(true)
        expect(actual.error.message).not.toContain('--lifecycle')
        expect(actual.error.message).not.toContain('--activities')
      },
    )
  }

  for (const typed of [[], ['x']]) {
    test(
      [
        `given ${name} ${typed.join(' ')} outside Git`,
        'when dispatched',
        'it should refuse the repository before parsing',
      ].join(', '),
      () => {
        // given
        // when
        const actual = planDispatch(RECIPE_DOCS)({
          ...input,
          repositoryRoot: undefined,
          argv: [name, ...typed],
        })
        // then
        expect(actual.status === 'error' && actual.error.message).toBe(
          `crust ${name}: /repo/sub is not inside a Git repository. Run \`git init\` to create one, then \`crust init\` to set pi-crust up in it.`,
        )
      },
    )
  }

  test(
    [
      `given ${name} with another lifecycle`,
      'when dispatched',
      'it should refuse the conflict',
    ].join(', '),
    () => {
      // given
      // when
      const actual = planDispatch(RECIPE_DOCS)({
        ...input,
        argv: [name, 'x', '--lifecycle', 'bugfix'],
      })
      // then
      expect(actual.status === 'error' && actual.error.message).toBe(
        `crust ${name}: --lifecycle bugfix conflicts with this command, which always runs the ${name} Lifecycle. Run \`crust run "<prompt>" --lifecycle bugfix\` instead.`,
      )
    },
  )

  test(
    [
      `given run selecting ${name}`,
      'when dispatched',
      'it should keep the long form unchanged',
    ].join(', '),
    () => {
      // given
      // when
      const actual = planDispatch(RECIPE_DOCS)({
        ...input,
        argv: ['run', 'x', '--lifecycle', name],
      })
      // then
      expect(actual.status === 'ok' && actual.data.args).toEqual([
        '--config',
        'pi-crust.toml',
        'x',
        '--lifecycle',
        name,
      ])
    },
  )
}

test(
  [
    'given ship with an Activities chain',
    'when dispatched',
    'it should refuse the conflicting selection',
  ].join(', '),
  () => {
    // given
    // when
    const actual = planDispatch(RECIPE_DOCS)({
      ...input,
      argv: ['ship', 'x', '--activities', 'plan,build'],
    })
    // then
    expect(actual.status === 'error' && actual.error.message).toBe(
      'crust ship: a lifecycle and a list of Activities cannot both be given. This command always runs the ship Lifecycle; got --activities plan,build. Run `crust run "<prompt>" --activities plan,build` instead.',
    )
  },
)

test(
  [
    'given a recorded ship invocation stopped after plan',
    'when its continuation is printed and dispatched',
    'it should resume the same run lifecycle and options',
  ].join(', '),
  () => {
    // given
    const planned = planDispatch(RECIPE_DOCS)({
      ...input,
      argv: ['ship', 'do something', '--approve-after', 'plan'],
    })
    expect(planned.status).toBe('ok')
    if (planned.status !== 'ok') return
    const invocation = ['bun', planned.data.script, ...planned.data.args]
    // when
    const line = recipeArgv(['bun', ...resumeArgv(invocation, 'a1b2c3d4')])
    expect(line).toBeDefined()
    if (line === undefined) return
    const resumed = planDispatch(RECIPE_DOCS)({
      ...input,
      argv: dispatchArgv(line),
    })
    // then
    expect(line).toEqual([
      'crust',
      'run',
      '--config',
      'pi-crust.toml',
      '--lifecycle',
      'ship',
      'do something',
      '--approve-after',
      'plan',
      '--run-id',
      'a1b2c3d4',
      '--resume',
    ])
    expect(resumed.status).toBe('ok')
    if (resumed.status !== 'ok') return
    expect(resumed.data.script).toBe('/pkg/runtime/commands/run.ts')
    expect(parseCli(resumed.data.args)).toMatchObject({
      lifecycle: 'ship',
      approveAfter: 'plan',
      runId: 'a1b2c3d4',
      resume: true,
      prompt: 'do something',
    })
  },
)

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
    'crust approve: missing <run-id>.\nusage: crust approve <run-id>',
  ],
  [
    ['join', 'id'],
    'crust join: missing <activity>.\nusage: crust join <run-id> <activity>',
  ],
  [
    ['default', 'two words'],
    'crust default: unexpected argument "two words".\nusage: crust default  (same as the bare `crust`)',
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
