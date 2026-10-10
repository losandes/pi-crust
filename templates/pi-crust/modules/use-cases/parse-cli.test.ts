import { expect, test } from 'bun:test'
import { parseCli } from './parse-cli'

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
      agent: undefined,
      base: undefined,
      resume: false,
      steps: undefined,
      lifecycle: undefined,
      approveAfter: undefined,
      deliver: undefined,
      stream: false,
      trustLevel: undefined,
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
      '--agent=scout',
    ]

    // when
    const actual = parseCli(argv)

    // then
    expect(actual).toEqual({
      prompt: 'implement the plan',
      config: 'other.yaml',
      runId: 'a1b2c3d4',
      agent: 'scout',
      base: undefined,
      resume: false,
      steps: undefined,
      lifecycle: undefined,
      approveAfter: undefined,
      deliver: undefined,
      stream: false,
      trustLevel: undefined,
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
    expect(() => parseCli(argv, '.pi-crust/stages/plan.ts')).toThrow(
      /a prompt is required[\s\S]*usage: bun \.pi-crust\/stages\/plan\.ts/,
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
    'when --steps is given a comma-separated list',
    'it should keep the list verbatim for the workflow to split',
  ].join(', '),
  () => {
    // given
    const argv = ['compose it', '--steps', 'plan,build,verify']

    // when
    const actual = parseCli(argv)

    // then
    expect(actual.steps).toEqual('plan,build,verify')
    expect(actual.prompt).toEqual('compose it')
  },
)
