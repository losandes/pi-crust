import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { TCatalogue } from './catalogue'
import {
  catalogueOf,
  main,
  renderCatalogue,
  reportUsageError,
  USAGE,
} from './catalogue'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from './modules/testing/terminal-capture'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

/*
 * Absolute, from import.meta.dir — the same way shipped-config.test.ts's
 * STAMP constant is built. A path relative to the PROCESS cwd broke this
 * test the moment it ran as part of a repository-wide `bun test` from the
 * repo root rather than scoped to runtime/, where cwd is runtime/ itself.
 */
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
    'given catalogue::catalogueOf',
    'when read against the shipped config',
    'it should list gh-pull-request under terminal',
  ].join(', '),
  () => {
    // given / when
    const actual = catalogueOf(SHIPPED_CONFIG)

    // then
    expect(actual.terminal.map((entry) => entry.name)).toEqual([
      'gh-pull-request',
    ])
    expect(actual.terminal[0]?.detail).not.toEqual('')
  },
)

test(
  [
    'given catalogue::renderCatalogue',
    'when a catalogue has entries in every section',
    'it should print each section with its own how-to line',
  ].join(', '),
  () => {
    // given
    const catalogue: TCatalogue = {
      lifecycles: [{ name: 'sdlc', detail: 'the standard chain' }],
      planners: [{ name: 'triage', detail: 'it recommends a chain and stops' }],
      activities: [
        { name: 'build', detail: 'write the code' },
        { name: 'secret', detail: 'internal (hidden from menus)' },
      ],
      terminal: [{ name: 'gh-pull-request', detail: 'opens the PR' }],
    }

    // when
    const actual = renderCatalogue(catalogue)

    // then
    expect(actual).toContain('lifecycles')
    expect(actual).toContain('sdlc')
    expect(actual).toContain('planners')
    expect(actual).toContain('triage')
    expect(actual).toContain('activities')
    expect(actual).toContain('build')
    expect(actual).toContain('terminal')
    expect(actual).toContain('gh-pull-request')
  },
)

test(
  [
    'given catalogue::renderCatalogue',
    'when a section has no entries at all',
    'it should print (none) rather than an empty section',
  ].join(', '),
  () => {
    // given
    const catalogue: TCatalogue = {
      lifecycles: [],
      planners: [],
      activities: [],
      terminal: [],
    }

    // when
    const actual = renderCatalogue(catalogue)

    // then
    expect(actual).toContain('(none)')
  },
)

test(
  [
    'given catalogue::main',
    'when run against the shipped config with no --config flag',
    'it should print the catalogue and return the success exit code',
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
  },
)

test(
  [
    'given catalogue::main',
    'when --config names the shipped config explicitly',
    'it should read that path rather than the environment default',
  ].join(', '),
  () => {
    // given, when
    const actual = main(['--config', SHIPPED_CONFIG])

    // then
    expect(actual).toEqual(0)
  },
)

test(
  [
    'given catalogue::main',
    'when the config cannot be read at all',
    'it should throw, which is what the import.meta.main boundary converts to USAGE',
  ].join(', '),
  () => {
    // given, when, then
    expect(() =>
      main(['--config', '/does/not/exist/crust.config.yaml']),
    ).toThrow()
  },
)

test(
  [
    'given catalogue::USAGE',
    'when printed',
    'it should name the --config flag and the CRUST_CONFIG override',
  ].join(', '),
  () => {
    // given, when, then
    expect(USAGE).toContain('--config')
    expect(USAGE).toContain('CRUST_CONFIG')
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
  },
)
