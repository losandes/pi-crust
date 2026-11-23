import { expect, test } from 'bun:test'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { topicOf } from './help-topic'

test(
  [
    'given help::topicOf',
    'when --config and its value are the only arguments',
    'it should find no topic',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const argv = ['--config', '/some/path.toml']

      // when
      const actual = topicOf(argv)

      // then
      expect(actual).toBeUndefined()
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given help::topicOf',
    'when a recipe name follows --config and its value',
    'it should return that recipe name',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const argv = ['--config', '/some/path.toml', 'run']

      // when
      const actual = topicOf(argv)

      // then
      expect(actual).toBe('run')
    } finally {
      restoreTerminal()
    }
  },
)
