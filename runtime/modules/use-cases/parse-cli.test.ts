import { expect, test } from 'bun:test'
import { FLAG_TABLE, parseCli } from './parse-cli'
import { errorMessage, safeParseSettlement } from '../typedefs/settlement'

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
      config: '.pi-crust/config/crust.config.yaml',
      runId: undefined,
      base: undefined,
      resume: false,
      activities: undefined,
      lifecycle: undefined,
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
      'other.yaml',
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
      config: 'other.yaml',
      runId: 'a1b2c3d4',
      base: undefined,
      resume: false,
      activities: undefined,
      lifecycle: undefined,
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
      /a prompt is required[\s\S]*usage: just crust run/,
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
    expect(() => parseCli(argv)).toThrow(/--steps was removed. Use --activities/)
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
      // given, when
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
    const expectedPairs = FLAG_TABLE.filter((flag) => flag.short !== undefined).map(
      (flag) => `${flag.short} ${flag.long}`,
    )

    // when
    const settled = safeParseSettlement(() => parseCli([], 'run'))
    const message = settled.status === 'error' ? errorMessage(settled.error) : ''

    // then
    for (const pair of expectedPairs) {
      expect(message).toContain(pair)
    }
  },
)
