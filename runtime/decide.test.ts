import { expect, test } from 'bun:test'
import { isVerb, parseDecideArgs, VERBS } from './decide'

// decide.ts is the one in-scope CLI from issue #54 whose own argv parser
// (`parseDecideArgs`) had no direct test: `resume.ts` and `steer.ts` are
// covered through `cli-positionals.test.ts` and `resume-run.test.ts`, and
// `decide.ts`'s own `positionalArgs(argv, DECIDE_CLI)` call is covered
// there too, but nothing proved that decide's wrapper actually surfaces
// that refusal rather than catching or reshaping it.

test(
  [
    'given decide::parseDecideArgs',
    'when a valid verb and run id are given',
    'it should parse both, with no note or file',
  ].join(', '),
  () => {
    // given
    const argv = ['approve', 'a1b2c3d4']

    // when
    const actual = parseDecideArgs(argv)

    // then
    expect(actual.verb).toEqual('approve')
    expect(actual.runId).toEqual('a1b2c3d4')
    expect(actual.note).toEqual('')
    expect(actual.file).toEqual('')
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when an unrecognised single-dash token is given',
    'it should refuse by name instead of reading it as the verb or run id',
  ].join(', '),
  () => {
    // given
    const argv = ['-x', 'approve', 'a1b2c3d4']

    // when, then
    expect(() => parseDecideArgs(argv)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when the unrecognised token sits between the verb and the run id',
    'it should still refuse by name rather than treating the token as the run id',
  ].join(', '),
  () => {
    // given
    const argv = ['reject', '-x', 'a1b2c3d4']

    // when, then
    expect(() => parseDecideArgs(argv)).toThrow(/unknown flag: -x/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when the token is exactly a bare dash',
    'it should refuse rather than read it as the run id',
  ].join(', '),
  () => {
    // given
    const argv = ['approve', '-']

    // when, then
    expect(() => parseDecideArgs(argv)).toThrow(/unknown flag/)
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when --note precedes the run id',
    'it should resolve the run id rather than the note text',
  ].join(', '),
  () => {
    // given
    const argv = ['reject', '--note', 'fix the thing', 'a1b2c3d4']

    // when
    const actual = parseDecideArgs(argv)

    // then
    expect(actual.runId).toEqual('a1b2c3d4')
    expect(actual.note).toEqual('fix the thing')
  },
)

test(
  [
    'given decide::isVerb',
    'when every entry in VERBS is inspected',
    'it should accept each one',
  ].join(', '),
  () => {
    // given, when, then
    for (const verb of VERBS) {
      expect(isVerb(verb)).toBe(true)
    }
  },
)
