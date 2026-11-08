import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { main, topicOf } from './help'
import { EXIT } from './lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from './testing/terminal-capture'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

const SHIPPED_CONFIG = join(
  import.meta.dir,
  '..',
  'templates',
  'stamp',
  'config',
  'crust.config.yaml',
)

test(
  [
    'given help::topicOf',
    'when --config and its value are the only arguments',
    'it should find no topic',
  ].join(', '),
  () => {
    // given
    const argv = ['--config', '/some/path.yaml']

    // when
    const actual = topicOf(argv)

    // then
    expect(actual).toBeUndefined()
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
    const argv = ['--config', '/some/path.yaml', 'run']

    // when
    const actual = topicOf(argv)

    // then
    expect(actual).toBe('run')
  },
)

test(
  [
    'given help::main',
    'when run with no further arguments',
    'it should print the whole reference and exit success',
  ].join(', '),
  () => {
    // given
    // when
    const actual = main(['--config', SHIPPED_CONFIG])

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('lifecycles')
    expect(terminalOutput()).toContain('run')
  },
)

test(
  [
    'given help::main',
    'when a documented recipe is named',
    "it should print only that recipe's entry and exit success",
  ].join(', '),
  () => {
    // given
    // when
    const actual = main(['--config', SHIPPED_CONFIG, 'run'])

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('--lifecycle')
  },
)

test(
  [
    'given help::main',
    'when an unknown recipe is named',
    'it should exit with the usage code',
  ].join(', '),
  () => {
    // given
    // when
    const actual = main(['--config', SHIPPED_CONFIG, 'nonsuch'])

    // then
    expect(actual).toBe(EXIT.USAGE)
  },
)

test(
  [
    'given help::main',
    'when the configuration cannot be read',
    'it should still print the recipe reference and exit success',
  ].join(', '),
  () => {
    // given
    // when
    const actual = main(['--config', '/nope/missing.yaml'])

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('run')
  },
)

test(
  [
    'given help::main',
    'when run with no --config flag and no CRUST_CONFIG set',
    'it should fall back to the built-in default path',
  ].join(', '),
  () => {
    // given
    const originalCrustConfig = process.env.CRUST_CONFIG
    delete process.env.CRUST_CONFIG

    // when
    const actual = main([])

    // then
    try {
      expect(actual).toBe(EXIT.SUCCESS)
      expect(terminalOutput()).toContain('run')
    } finally {
      if (originalCrustConfig !== undefined) {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_CONFIG = originalCrustConfig
      }
    }
  },
)

test(
  [
    'given help::main',
    'when run with no --config flag but CRUST_CONFIG set',
    'it should read the path from the environment',
  ].join(', '),
  () => {
    // given
    const originalCrustConfig = process.env.CRUST_CONFIG
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API main() reads through configPathFromEnv
    process.env.CRUST_CONFIG = SHIPPED_CONFIG

    // when
    const actual = main([])

    // then
    try {
      expect(actual).toBe(EXIT.SUCCESS)
      expect(terminalOutput()).toContain('lifecycles')
    } finally {
      if (originalCrustConfig === undefined) {
        delete process.env.CRUST_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_CONFIG = originalCrustConfig
      }
    }
  },
)
