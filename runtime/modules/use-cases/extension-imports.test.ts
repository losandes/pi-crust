import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { piReleaseDir, resolvesFrom } from '../data/pi-host'
import { importedPackages, packageOf } from './extension-imports'

const HARNESS_DIR = join(import.meta.dir, '..', '..', 'harness-engineering')

const extensionSources = (): readonly string[] =>
  readdirSync(HARNESS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .toSorted()

test(
  [
    'given use-cases/extension-imports::packageOf',
    'when the specifier names a file inside a scoped package',
    'it should keep the scope and drop the path',
  ].join(', '),
  () => {
    expect(packageOf('@earendil-works/pi-ai/models')).toEqual(
      '@earendil-works/pi-ai',
    )
    expect(packageOf('typebox/compile')).toEqual('typebox')
  },
)

test(
  [
    'given use-cases/extension-imports::importedPackages',
    'when the source imports packages, files and builtins',
    'it should report only the packages, once each',
  ].join(', '),
  () => {
    const source = [
      "import { Type } from 'typebox'",
      "import { Container, Text } from '@earendil-works/pi-tui'",
      "import type { TUI } from '@earendil-works/pi-tui'",
      "import { basename } from 'node:path'",
      "import { expect } from 'bun:test'",
      "import { local } from './local'",
      "export { thing } from '@earendil-works/pi-ai'",
    ].join('\n')

    expect(importedPackages(source)).toEqual([
      '@earendil-works/pi-ai',
      '@earendil-works/pi-tui',
      'typebox',
    ])
  },
)

test(
  [
    'given use-cases/extension-imports::importedPackages',
    'when prose in a comment reads like an import statement',
    'it should not mistake English for a dependency',
  ].join(', '),
  () => {
    const source = [
      '/**',
      " * Read it from 'the beginning', and ask about",
      " * anything that matters. require('a second opinion') first.",
      ' */',
      "import { Type } from 'typebox'",
    ].join('\n')

    expect(importedPackages(source)).toEqual(['typebox'])
  },
)

test(
  [
    'given use-cases/extension-imports',
    'when the harness extensions are read',
    'it should find the packages they expect the host to provide',
  ].join(', '),
  () => {
    const found = extensionSources().flatMap((name) =>
      importedPackages(readFileSync(join(HARNESS_DIR, name), 'utf8')),
    )

    // Not an allowlist — the assertion is that the scan sees something at all.
    // A regex that silently matched nothing would make the check below pass
    // for every possible state of the tree, which is the failure mode this
    // whole file exists to avoid.
    expect(found.length).toBeGreaterThan(0)
  },
)

/*
 * The check itself. `harness-engineering` is excluded from tsc, so this is
 * the only thing standing between a host package rename and an extension
 * that fails to load mid-run.
 *
 * Skipped, loudly, where the managed pi install cannot be found: a machine
 * without pi has learned nothing about these imports, and a test that failed
 * there would be reporting the absence of pi, not a broken import.
 */
const release = piReleaseDir()

test.skipIf(release === undefined)(
  [
    'given use-cases/extension-imports',
    'when every package the harness extensions import is resolved against the installed pi',
    'it should find all of them, because the host is what provides them',
  ].join(', '),
  () => {
    const host = release ?? ''
    const unresolved = extensionSources().flatMap((name) =>
      importedPackages(readFileSync(join(HARNESS_DIR, name), 'utf8'))
        .filter((pkg) => !resolvesFrom(pkg, host))
        .map((pkg) => `${name}: ${pkg}`),
    )

    expect(unresolved).toEqual([])
  },
)

test.skipIf(release === undefined)(
  [
    'given data/pi-host::resolvesFrom',
    'when asked for a package the host does not ship',
    'it should answer false, so the check above can fail when it should',
  ].join(', '),
  () => {
    expect(resolvesFrom('@mariozechner/pi-ai', release ?? '')).toBe(false)
    expect(resolvesFrom('@earendil-works/pi-ai', release ?? '')).toBe(true)
  },
)
