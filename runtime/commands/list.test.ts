import { expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { main } from './list'

/*
 * Absolute, from resolve(import.meta.dir, '..') — the same way shipped-config.test.ts's
 * STAMP constant is built. A path relative to the PROCESS cwd broke this
 * test the moment it ran as part of a repository-wide `bun test` from the
 * repo root rather than scoped to runtime/, where cwd is runtime/ itself.
 */
const SHIPPED_CONFIG = join(
  resolve(import.meta.dir, '..'),
  '..',
  'templates',
  'stamp',
  'config',
  'crust.config.yaml',
)

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
      const actual = main([])

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
      // given, when
      // when
      const actual = main(['--config', SHIPPED_CONFIG])

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
      // given, when, then
      // when
      // then
      expect(main(['--config', '/does/not/exist/crust.config.yaml'])).toBe(2)
    } finally {
      restoreTerminal()
    }
  },
)
