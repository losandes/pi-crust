import { expect, spyOn, test } from 'bun:test'
import { errorMessage, safeParseSettlement } from '../../../../../lib/typedefs'
import {
  FLAG_TABLE,
  lifecycleUsage,
  longFlagArgv,
  parseCli,
  runCli,
  workflowArgs,
} from './parse-cli'

/**
 * `process.argv` is the external API `runCli` reads, and pointing it at a
 * fixture is the only way to exercise the entry boundary. Assigning to it is
 * the adapter, said once here rather than at every call site.
 */
const setArgv = (value: readonly string[]): void => {
  // biome-ignore lint/plugin/no-object-mutation: process.argv is the external API runCli reads, and this function is the adapter that owns the assignment
  process.argv = [...value]
}

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when only a prompt is given',
    'it should default the config and leave the rest unset',
  ].join(', '),
  () => {
    // given
    const argv = ['add a /health endpoint']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual).toEqual({
      prompt: 'add a /health endpoint',
      config: 'pi-crust.toml',
      runId: undefined,
      base: undefined,
      resume: false,
      activities: undefined,
      lifecycle: undefined,
      models: undefined,
      approveAfter: undefined,
      commit: undefined,
      stream: false,
      trustLevel: undefined,
      handoff: undefined,
      name: undefined,
    })
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when flags surround the positional prompt',
    'it should read every flag and still find the prompt',
  ].join(', '),
  () => {
    // given
    const argv = [
      '--config',
      'other.toml',
      'implement the plan',
      '--run-id',
      'a1b2c3d4',
      '--commit=false',
    ]

    // when
    const actual = parseCli(argv)

    // then
    expect(actual).toEqual({
      prompt: 'implement the plan',
      config: 'other.toml',
      runId: 'a1b2c3d4',
      base: undefined,
      resume: false,
      activities: undefined,
      lifecycle: undefined,
      models: undefined,
      approveAfter: undefined,
      commit: 'false',
      stream: false,
      trustLevel: undefined,
      handoff: undefined,
      name: undefined,
    })
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when no prompt is given at all',
    'it should throw with the usage line',
  ].join(', '),
  () => {
    // given
    const argv = ['--run-id', 'a1b2c3d4']

    // when, then
    expect(() => parseCli(argv, 'run')).toThrow(
      /a prompt is required[\s\S]*usage: crust run/,
    )
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a flag is given its value',
    'it should not mistake that value for the prompt',
  ].join(', '),
  () => {
    // given
    const argv = ['--base', 'HEAD~1', 'write up the change']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.base).toEqual('HEAD~1')
    expect(actual.prompt).toEqual('write up the change')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --resume precedes the prompt',
    'it should set the flag and still find the prompt',
  ].join(', '),
  () => {
    // given a boolean flag listed with the value flags would EAT this prompt
    const argv = ['--resume', 'do the thing', '--run-id', 'a1b2c3d4']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.resume).toEqual(true)
    expect(actual.prompt).toEqual('do the thing')
    expect(actual.runId).toEqual('a1b2c3d4')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --activities is given a chain',
    'it should keep the value verbatim for the Composer to parse',
  ].join(', '),
  () => {
    // given
    const argv = ['compose it', '--activities', 'plan,build,review+code-review']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.activities).toEqual('plan,build,review+code-review')
    expect(actual.prompt).toEqual('compose it')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when the removed --steps flag is used',
    'it should refuse by name rather than swallow it as the prompt',
  ].join(', '),
  () => {
    // given — an unknown flag becomes a positional, so silence here would
    // start a run on the word "--steps"
    const argv = ['compose it', '--steps', 'plan,build']

    // when, then
    expect(() => parseCli(argv)).toThrow(
      /--steps was removed. Use --activities/,
    )
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --commit is given a value other than false',
    'it should refuse, because the flag can only ever subtract',
  ].join(', '),
  () => {
    // given — `--commit true` would grant a permission the registry
    // withheld, and a run nobody could predict from reading the registry
    const argv = ['do the thing', '--commit', 'true']

    // when
    const actual = () => parseCli(argv)

    // then
    expect(actual).toThrow(/--commit takes only 'false'/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a flag is misspelled',
    'it should refuse and name the one it meant, not read it as the prompt',
  ].join(', '),
  () => {
    // given — one letter wrong. This used to fall through to the positional
    // list, leaving --lifecycle unset, and the run failed saying --activities
    // was required: a true sentence about the wrong problem.
    const argv = ['do the thing', '--lifecycles', 'sdlc']

    // when, then
    expect(() => parseCli(argv)).toThrow(/unknown flag: --lifecycles/)
    expect(() => parseCli(argv)).toThrow(/did you mean --lifecycle\?/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a flag nothing resembles is given',
    'it should still refuse, rather than swallow it as part of the prompt',
  ].join(', '),
  () => {
    // given
    const argv = ['do the thing', '--wat', 'x']

    // when, then
    expect(() => parseCli(argv)).toThrow(/unknown flag: --wat/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when the prompt itself contains a double dash',
    'it should stay the prompt, because only a LEADING -- is a flag',
  ].join(', '),
  () => {
    // given
    const argv = ['rename the --steps flag in the docs']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.prompt).toEqual('rename the --steps flag in the docs')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --handoff and --name are given, in --flag value form',
    'it should parse both',
  ].join(', '),
  () => {
    // given
    const argv = [
      'do the thing',
      '--handoff',
      'specs/{session_id}',
      '--name',
      'payments rewrite',
    ]

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.handoff).toEqual('specs/{session_id}')
    expect(actual.name).toEqual('payments rewrite')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --handoff and --name are given, in --flag=value form',
    'it should parse both',
  ].join(', '),
  () => {
    // given
    const argv = [
      'do the thing',
      '--handoff=specs/{run_id}',
      '--name=payments rewrite',
    ]

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.handoff).toEqual('specs/{run_id}')
    expect(actual.name).toEqual('payments rewrite')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --name contains a newline',
    'it should refuse at parse time, the same way an invalid --commit does',
  ].join(', '),
  () => {
    // given
    const argv = ['do the thing', '--name', 'two\nlines']

    // when, then
    expect(() => parseCli(argv)).toThrow(/newline/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --handoff is given an empty value',
    'it should refuse rather than silently fall back to the default',
  ].join(', '),
  () => {
    // given
    const argv = ['do the thing', '--handoff', '']

    // when, then
    expect(() => parseCli(argv)).toThrow(/--handoff takes a path/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when neither flag is given',
    'it should leave both fields undefined',
  ].join(', '),
  () => {
    // given
    const argv = ['do the thing']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.handoff).toBeUndefined()
    expect(actual.name).toBeUndefined()
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when --handof (missing a letter) is given',
    'it should still suggest --handoff',
  ].join(', '),
  () => {
    // given
    const argv = ['do the thing', '--handof', 'specs']

    // when, then
    expect(() => parseCli(argv)).toThrow(/did you mean --handoff/)
  },
)

const shortFormEquivalences: ReadonlyArray<{
  name: string
  short: readonly string[]
  long: readonly string[]
}> = [
  {
    name: '-a',
    short: ['do the thing', '-a', 'plan,build'],
    long: ['do the thing', '--activities', 'plan,build'],
  },
  {
    name: '-c',
    short: ['do the thing', '-c', 'false'],
    long: ['do the thing', '--commit', 'false'],
  },
  {
    name: '-l',
    short: ['do the thing', '-l', 'sdlc'],
    long: ['do the thing', '--lifecycle', 'sdlc'],
  },
  {
    name: '-m',
    short: ['do the thing', '-m', 'build=openai/gpt-5@high'],
    long: ['do the thing', '--model', 'build=openai/gpt-5@high'],
  },
  {
    name: '-n',
    short: ['do the thing', '-n', 'payments rewrite'],
    long: ['do the thing', '--name', 'payments rewrite'],
  },
  {
    name: '-r',
    short: ['do the thing', '-r'],
    long: ['do the thing', '--resume'],
  },
  {
    name: '-id',
    short: ['do the thing', '-id', 'a1b2c3d4'],
    long: ['do the thing', '--run-id', 'a1b2c3d4'],
  },
]

for (const { name, short, long } of shortFormEquivalences) {
  test(
    [
      'given use-cases/parse-cli::parseCli',
      `when ${name} is used instead of its long form`,
      'it should parse identically to the long form',
    ].join(', '),
    () => {
      // given — the table supplies both argv forms
      // when
      const actual = parseCli(short)
      const expected = parseCli(long)

      // then
      expect(actual).toEqual(expected)
    },
  )
}

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a short flag is given inline with =',
    'it should parse identically to the long =form',
  ].join(', '),
  () => {
    // given
    const short = ['-l=sdlc', 'p']
    const long = ['--lifecycle=sdlc', 'p']

    // when
    const actual = parseCli(short)
    const expected = parseCli(long)

    // then
    expect(actual).toEqual(expected)
  },
)

test(
  [
    'given use-cases/parse-cli::FLAG_TABLE',
    'when every entry is inspected',
    'it should have no two entries sharing a short name',
  ].join(', '),
  () => {
    // given
    const shorts = FLAG_TABLE.map((flag) => flag.short).filter(
      (short): short is string => short !== undefined,
    )

    // when
    const unique = new Set(shorts)

    // then
    expect(unique.size).toEqual(shorts.length)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when an unrecognised single-dash token is given',
    'it should refuse by name instead of reading it as the prompt',
  ].join(', '),
  () => {
    // given
    const argv = ['-x', 'foo', 'the prompt']

    // when, then
    expect(() => parseCli(argv)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when the token is exactly a bare dash',
    'it should refuse rather than read it as the prompt',
  ].join(', '),
  () => {
    // given
    const argv = ['-', 'the prompt']

    // when, then
    expect(() => parseCli(argv)).toThrow(/unknown flag/)
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a usage line is produced',
    'it should list every short flag beside its long name',
  ].join(', '),
  () => {
    // given
    const expectedPairs = FLAG_TABLE.filter(
      (flag) => flag.short !== undefined,
    ).map((flag) => `${flag.short} ${flag.long}`)

    // when
    const settled = safeParseSettlement(() => parseCli([], 'run'))
    const message =
      settled.status === 'error' ? errorMessage(settled.error) : ''

    // then
    for (const pair of expectedPairs) {
      expect(message).toContain(pair)
    }
    expect(message).toContain('[--model <activity>=<model>@<thinking>,...]')
  },
)

test(
  [
    'given use-cases/parse-cli::workflowArgs',
    'when a prompt has already been resolved from a file',
    'it should fold it into the parsed args, carrying everything else through',
  ].join(', '),
  () => {
    // given
    const args = parseCli(['build it'])

    // when
    const actual = workflowArgs(args, 'the resolved prompt text')

    // then
    expect(actual).toEqual({
      ...args,
      prompt: 'the resolved prompt text',
      promptPath: args.prompt,
    })
  },
)

test(
  [
    'given use-cases/parse-cli::runCli',
    'when argv fails to parse',
    'it should print the error and exit 2, never reaching the handler',
  ].join(', '),
  async () => {
    // given
    const originalArgv = process.argv
    setArgv(['bun', 'run.ts'])
    const exitSpy = spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const writes: string[] = []
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string,
    ) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was written is the test
      writes.push(chunk)
      return true
    }) as never)
    let handlerCalled = false

    try {
      // when, then
      await expect(
        runCli('run.ts', () => {
          handlerCalled = true
          return Promise.resolve(0)
        }),
      ).rejects.toThrow('exit:2')
    } finally {
      setArgv(originalArgv)
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
    }

    // then
    expect(handlerCalled).toBe(false)
    expect(writes.join('')).toContain('usage')
  },
)

test(
  [
    'given use-cases/parse-cli::runCli',
    'when argv parses but the handler throws',
    'it should print the error and exit 1',
  ].join(', '),
  async () => {
    // given
    const originalArgv = process.argv
    setArgv(['bun', 'run.ts', 'add a /health endpoint'])
    const exitSpy = spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`)
    }) as never)
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(
      (() => true) as never,
    )

    try {
      // when, then
      await expect(
        runCli('run.ts', () =>
          Promise.reject(new Error('the handler blew up')),
        ),
      ).rejects.toThrow('exit:1')
    } finally {
      setArgv(originalArgv)
      exitSpy.mockRestore()
      stderrSpy.mockRestore()
    }
  },
)

test(
  [
    'given use-cases/parse-cli::runCli',
    'when argv parses and the handler succeeds',
    'it should exit with the handler\u2019s own code',
  ].join(', '),
  async () => {
    // given
    const originalArgv = process.argv
    setArgv(['bun', 'run.ts', 'add a /health endpoint'])
    const exitSpy = spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit:${code}`)
    }) as never)

    try {
      // when, then
      await expect(runCli('run.ts', () => Promise.resolve(0))).rejects.toThrow(
        'exit:0',
      )
    } finally {
      setArgv(originalArgv)
      exitSpy.mockRestore()
    }
  },
)

test(
  [
    'given use-cases/parse-cli::longFlagArgv',
    'when argv mixes short and long flags, with a value after a value-taking short flag',
    'it should rewrite every short flag to its long name and leave values untouched',
  ].join(', '),
  () => {
    // given
    const argv = ['-a', 'build,review', '--resume', '-r']

    // when
    const actual = longFlagArgv(argv)

    // then
    expect(actual).toEqual([
      '--activities',
      'build,review',
      '--resume',
      '--resume',
    ])
  },
)

test(
  [
    'given use-cases/parse-cli::longFlagArgv',
    'when a short flag is given inline with =',
    'it should rewrite only the flag name, keeping the inline value',
  ].join(', '),
  () => {
    // given
    const argv = ['-a=build,review']

    // when
    const actual = longFlagArgv(argv)

    // then
    expect(actual).toEqual(['--activities=build,review'])
  },
)

test(
  [
    'given use-cases/parse-cli::longFlagArgv',
    'when a token names no known short flag',
    'it should pass it through unchanged',
  ].join(', '),
  () => {
    // given
    const argv = ['a plain prompt, not a flag']

    // when
    const actual = longFlagArgv(argv)

    // then
    expect(actual).toEqual(argv)
  },
)

const SHIP_USAGE =
  'usage: crust ship "<prompt or path/to/prompt.md>" [options]\n' +
  '  runs the ship Lifecycle as this repository configures it; `crust list` describes it.\n' +
  '  optional: [--config <path>] [--run-id <id>] [--commit false] [--scope <ref|range|path|glob>] [--approve-after identify,design] [--model <activity>=<model>@<thinking>,...] [--trust-level <none|low|medium|high>] [--stream] [--resume] [--handoff <path/{session_id}>] [--name <label>]\n' +
  '  short: -id --run-id, -m --model, -c --commit, -n --name, -r --resume\n' +
  'env: CRUST_CONFIG overrides the config path; --config still wins.'

test(
  [
    'given ship usage',
    'when rendered',
    'it should describe the configured lifecycle and shared options exactly',
  ].join(', '),
  () => {
    // given
    // when
    const actual = lifecycleUsage('ship', 'ship')
    // then
    expect(actual).toBe(SHIP_USAGE)
  },
)

for (const name of ['gh-issue', 'ship', 'ship-plan', 'ship-outcome']) {
  test(
    [
      `given ${name} usage`,
      'when rendered',
      'it should ask only for a prompt and run options',
    ].join(', '),
    () => {
      // given
      // when
      const actual = lifecycleUsage(name, name)
      // then
      expect(actual.startsWith(`usage: crust ${name} "`)).toBe(true)
      for (const selection of ['--lifecycle', '--activities', '-l ', '-a '])
        expect(actual).not.toContain(selection)
    },
  )
}

for (const [argv, message] of [
  [[], 'a prompt is required'],
  [['x', '--frob'], 'unknown flag: --frob'],
  [['x', '--name'], '--name needs a value'],
] as const) {
  test(
    [
      `given ship arguments ${argv.join(' ')}`,
      'when parsing fails with custom usage',
      'it should append that usage unchanged',
    ].join(', '),
    () => {
      // given
      // when
      const actual = safeParseSettlement(() =>
        parseCli(argv, 'ship', lifecycleUsage('ship', 'ship')),
      )
      // then
      expect(actual.status === 'error' && actual.error.message).toBe(
        `${message}\n${SHIP_USAGE}`,
      )
    },
  )
}

const MODEL_VALUE = 'build=openai/gpt-5@high,test=@high'
const modelFlagForms = [
  { form: '--model <value>', argv: ['--model', MODEL_VALUE] },
  { form: '--model=<value>', argv: [`--model=${MODEL_VALUE}`] },
  { form: '-m <value>', argv: ['-m', MODEL_VALUE] },
  { form: '-m=<value>', argv: [`-m=${MODEL_VALUE}`] },
] as const

for (const { form, argv } of modelFlagForms) {
  test(
    [
      'given use-cases/parse-cli::parseCli',
      `when ${form} is given`,
      'it should preserve the raw model override list',
    ].join(', '),
    () => {
      // given
      const input = ['build it', ...argv]

      // when
      const actual = parseCli(input)

      // then
      expect(actual.models).toBe(MODEL_VALUE)
    },
  )

  for (const later of modelFlagForms) {
    test(
      [
        'given use-cases/parse-cli::parseCli',
        `when ${form} is followed by ${later.form}`,
        'it should refuse repeated model flags rather than discard an earlier value',
      ].join(', '),
      () => {
        // given
        const input = ['build it', ...argv, ...later.argv]

        // when, then
        expect(() => parseCli(input)).toThrow(
          '--model was given more than once — combine the entries into one comma-separated list, e.g. --model build=openai/gpt-5,test=@high',
        )
      },
    )
  }
}

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a model flag repeats after an empty value',
    'it should still refuse the repeated flag',
  ].join(', '),
  () => {
    // given
    const argv = ['build it', '--model=', '-m', MODEL_VALUE]

    // when, then
    expect(() => parseCli(argv)).toThrow('--model was given more than once')
  },
)

test(
  [
    'given use-cases/parse-cli::parseCli',
    'when a different value flag repeats',
    'it should keep its existing last-value-wins behaviour',
  ].join(', '),
  () => {
    // given
    const argv = ['build it', '--lifecycle', 'sdlc', '-l=deliver']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.lifecycle).toBe('deliver')
  },
)
