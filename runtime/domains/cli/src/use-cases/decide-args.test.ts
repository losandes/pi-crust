import { expect, spyOn, test } from 'bun:test'
import { EXIT } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import {
  isVerb,
  parseDecideArgs,
  DECIDE_USAGE as USAGE,
  reportUsageError as usageError,
  VERBS,
} from '../..'

const reportUsageError = usageError(USAGE)

test(
  [
    'given decide::parseDecideArgs',
    'when a valid verb and run id are given',
    'it should parse both, with no note or file',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const argv = ['approve', 'a1b2c3d4']

      // when
      const actual = parseDecideArgs(argv)

      // then
      expect(actual.verb).toEqual('approve')
      expect(actual.runId).toEqual('a1b2c3d4')
      expect(actual.note).toEqual('')
      expect(actual.file).toEqual('')
    } finally {
      restoreTerminal()
    }
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
    silenceTerminal()
    try {
      // given
      const argv = ['-x', 'approve', 'a1b2c3d4']

      // when, then
      // then
      expect(() => parseDecideArgs(argv)).toThrow(/unknown flag: -x/)
    } finally {
      restoreTerminal()
    }
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
    silenceTerminal()
    try {
      // given
      const argv = ['reject', '-x', 'a1b2c3d4']

      // when, then
      // then
      expect(() => parseDecideArgs(argv)).toThrow(/unknown flag: -x/)
    } finally {
      restoreTerminal()
    }
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
    silenceTerminal()
    try {
      // given
      const argv = ['approve', '-']

      // when, then
      // then
      expect(() => parseDecideArgs(argv)).toThrow(/unknown flag/)
    } finally {
      restoreTerminal()
    }
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
    silenceTerminal()
    try {
      // given
      const argv = ['reject', '--note', 'fix the thing', 'a1b2c3d4']

      // when
      const actual = parseDecideArgs(argv)

      // then
      expect(actual.runId).toEqual('a1b2c3d4')
      expect(actual.note).toEqual('fix the thing')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::isVerb',
    'when every entry in VERBS is inspected',
    'it should accept each one',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      for (const verb of VERBS) {
        // when
        // then
        expect(isVerb(verb)).toBe(true)
      }
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::isVerb',
    'when the value is not a recognised verb',
    'it should say so',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      // when
      // then
      expect(isVerb('deny')).toBe(false)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when the first argument is not a recognised verb',
    'it should throw naming the ones it accepts',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      // when
      // then
      expect(() => parseDecideArgs(['deny', 'fbf49583'])).toThrow(
        /must be one of approve, reject, answer/,
      )
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when no run-id follows the verb',
    'it should throw, because there is nothing to answer',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      // when
      // then
      expect(() => parseDecideArgs(['approve'])).toThrow(/run-id is required/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::parseDecideArgs',
    'when every flag is given',
    'it should parse all of them, including --detach',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // when
      const actual = parseDecideArgs([
        'reject',
        'fbf49583',
        '--note',
        'wrong approach',
        '--file',
        'answer.md',
        '--db',
        '/tmp/crust.db',
        '--config',
        '/tmp/pi-crust.toml',
        '--detach',
      ])

      // then
      expect(actual).toEqual({
        verb: 'reject',
        runId: 'fbf49583',
        note: 'wrong approach',
        file: 'answer.md',
        db: '/tmp/crust.db',
        config: '/tmp/pi-crust.toml',
        detach: true,
      })
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::reportUsageError',
    'when main rejects with a parse error',
    'it should print the message and USAGE to stderr and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const writes: string[] = []
      const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(((
        chunk: string,
      ) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was written is the test
        writes.push(chunk)
        return true
      }) as never)

      try {
        // when
        const actual = reportUsageError(new Error('an run-id is required'))

        // then
        expect(actual).toEqual(EXIT.USAGE)
        expect(writes.join('')).toContain('an run-id is required')
        expect(writes.join('')).toContain(USAGE)
      } finally {
        stderrSpy.mockRestore()
      }
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given decide::USAGE',
    'when printed',
    'it should name all three verbs and both overrides',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      // when
      // then
      expect(USAGE).toContain('approve')
      expect(USAGE).toContain('reject')
      expect(USAGE).toContain('answer')
      expect(USAGE).toContain('CRUST_DB')
      expect(USAGE).toContain('CRUST_CONFIG')
    } finally {
      restoreTerminal()
    }
  },
)
