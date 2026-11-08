import { expect, test } from 'bun:test'
import {
  DECIDE_CLI,
  positionalArgs,
  RESUME_CLI,
  STEER_CLI,
} from './cli-positionals'

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when a value flag follows the positional',
    'it should drop the flag and its value',
  ].join(', '),
  () => {
    // given
    const argv = ['abc', '--note', 'fix']

    // when
    const actual = positionalArgs(argv, RESUME_CLI)

    // then
    expect(actual).toEqual(['abc'])
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when a value flag precedes the positional',
    'it should still find the positional',
  ].join(', '),
  () => {
    // given
    const argv = ['--note', 'fix', 'abc']

    // when
    const actual = positionalArgs(argv, RESUME_CLI)

    // then
    expect(actual).toEqual(['abc'])
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    "when a flag's value itself starts with a dash",
    'it should treat the value as a value, not as an unknown flag',
  ].join(', '),
  () => {
    // given
    const argv = ['abc', '--note', '-9 is wrong']

    // when
    const actual = positionalArgs(argv, RESUME_CLI)

    // then
    expect(actual).toEqual(['abc'])
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when an unrecognised single-dash token is given to RESUME_CLI',
    'it should refuse by name',
  ].join(', '),
  () => {
    // given
    const argv = ['-x', 'abc']

    // when, then
    expect(() => positionalArgs(argv, RESUME_CLI)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when an unrecognised single-dash token is given to STEER_CLI',
    'it should refuse by name',
  ].join(', '),
  () => {
    // given
    const argv = ['-x', 'abc']

    // when, then
    expect(() => positionalArgs(argv, STEER_CLI)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when an unrecognised single-dash token is given to DECIDE_CLI',
    'it should refuse by name',
  ].join(', '),
  () => {
    // given
    const argv = ['-x', 'abc']

    // when, then
    expect(() => positionalArgs(argv, DECIDE_CLI)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when STEER_CLI switches and a value flag surround the positionals',
    'it should keep every positional, including the instruction',
  ].join(', '),
  () => {
    // given
    const argv = ['r1', 'build', '--branch', 'do it', '--seeding', 'fresh']

    // when
    const actual = positionalArgs(argv, STEER_CLI)

    // then
    expect(actual).toEqual(['r1', 'build', 'do it'])
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when DECIDE_CLI a switch follows the positionals',
    'it should keep both positionals and drop the switch',
  ].join(', '),
  () => {
    // given
    const argv = ['approve', 'abc', '--detach']

    // when
    const actual = positionalArgs(argv, DECIDE_CLI)

    // then
    expect(actual).toEqual(['approve', 'abc'])
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when --note precedes a run id, as in `resume --note "fix" abc`',
    'it should resolve the run id rather than the note text',
  ].join(', '),
  () => {
    // given — today the first non-`--` token is `fix`, so a run named `fix`
    // is looked up instead of `abc`
    const argv = ['--note', 'fix', 'abc']

    // when
    const actual = positionalArgs(argv, RESUME_CLI)

    // then
    expect(actual[0]).toEqual('abc')
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when --detach precedes a run id, as in `approve --detach abc`',
    'it should keep the run id rather than dropping it',
  ].join(', '),
  () => {
    // given — today the token after any `--` flag is dropped, so the run id
    // goes missing
    const argv = ['approve', '--detach', 'abc']

    // when
    const actual = positionalArgs(argv, DECIDE_CLI)

    // then
    expect(actual).toEqual(['approve', 'abc'])
  },
)

test(
  [
    'given use-cases/cli-positionals::positionalArgs',
    'when the token is exactly a bare dash or a double dash',
    'it should refuse both, with no escape-hatch separator',
  ].join(', '),
  () => {
    // given, when, then
    expect(() => positionalArgs(['-', 'abc'], RESUME_CLI)).toThrow(
      /unknown flag/,
    )
    expect(() => positionalArgs(['--', 'abc'], RESUME_CLI)).toThrow(
      /unknown flag/,
    )
  },
)
