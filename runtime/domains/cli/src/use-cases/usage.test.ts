import { expect, test } from 'bun:test'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { LIST_USAGE as USAGE, reportUsageError as usageError } from './usage'

const reportUsageError = usageError(USAGE)

test(
  [
    'given catalogue::USAGE',
    'when printed',
    'it should name the --config flag and the CRUST_CONFIG override',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given, when, then
      // when
      // then
      expect(USAGE).toContain('--config')
      expect(USAGE).toContain('CRUST_CONFIG')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given catalogue::reportUsageError',
    'when main rejects with a parse error',
    'it should print the message and USAGE to stderr and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const original = process.stderr.write.bind(process.stderr)
      let printed = ''
      // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
      process.stderr.write = ((chunk: string) => {
        printed += chunk
        return true
      }) as typeof process.stderr.write

      // when
      const actual = reportUsageError(new Error('config not found'))

      // then
      // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
      process.stderr.write = original
      expect(actual).toEqual(2)
      expect(printed).toContain('config not found')
      expect(printed).toContain('--config')
    } finally {
      restoreTerminal()
    }
  },
)
