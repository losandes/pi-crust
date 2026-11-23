import { expect, test } from 'bun:test'
import {
  EMPTY_REPOSITORY_PATH,
  withShippedPackage,
} from '../testing/shipped-layer'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { main } from './list'

const SHIPPED_CONFIG = EMPTY_REPOSITORY_PATH

test(
  [
    'given catalogue::main',
    'when run against the shipped config with no --config flag',
    'it should print the catalogue and return the success exit code',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const originalCrustConfig = process.env.CRUST_CONFIG
      // biome-ignore lint/plugin/no-object-mutation: process.env is the external API main() reads through configPathFromEnv
      process.env.CRUST_CONFIG = SHIPPED_CONFIG

      // when
      const actual = withShippedPackage(() => main([]))

      // then
      try {
        expect(actual).toEqual(0)
        expect(terminalOutput()).toContain('gh-pull-request')
      } finally {
        if (originalCrustConfig === undefined) {
          delete process.env.CRUST_CONFIG
        } else {
          // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
          process.env.CRUST_CONFIG = originalCrustConfig
        }
      }
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given catalogue::main',
    'when --config names the shipped config explicitly',
    'it should read that path rather than the environment default',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // when
      const actual = withShippedPackage(() =>
        main(['--config', SHIPPED_CONFIG]),
      )

      // then
      expect(actual).toEqual(0)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given catalogue::main',
    'when the config cannot be read at all',
    'it should throw, which is what the import.meta.main boundary converts to USAGE',
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
      expect(main(['--config', '/does/not/exist/pi-crust.toml'])).toBe(2)
    } finally {
      restoreTerminal()
    }
  },
)
