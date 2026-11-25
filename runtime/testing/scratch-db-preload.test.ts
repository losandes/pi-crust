import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDataPaths } from '../domains/workspace'
import {
  dbPathFromEnv,
  machineConfigDirFromEnv,
  packageConfigDirFromEnv,
} from '../lib/system'

/*
 * The preload has no exports to call: it arms `process.env` at import time,
 * and `bunfig.toml` imports it before any test file. What is worth proving is
 * that it is WIRED — a `preload` entry nobody checks is one that can be
 * dropped from the configuration, and every test would silently go back to
 * resolving the developer's real trace database.
 */

test(
  [
    'given testing/scratch-db-preload',
    'when any test asks where the database is through the environment',
    'it should be a scratch path, so no test reaches the real trace database',
  ].join(', '),
  () => {
    // given
    // bunfig.toml's [test] preload ran before this file was imported

    // when
    const actual = dbPathFromEnv()

    // then
    expect(actual).toBeDefined()
    expect(actual).toStartWith(tmpdir())
  },
)

test(
  [
    'given testing/scratch-db-preload',
    'when the scratch path it named is looked for on disk',
    'it should not exist, so a test that writes a database there fails loudly',
  ].join(', '),
  () => {
    // given
    const dbPath = dbPathFromEnv() ?? ''

    // when
    const actual = existsSync(dbPath)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given a test process with the data-path preload',
    'when a fixture supplies its own data directory',
    'it should resolve the fixture directory instead of inherited run history',
  ].join(', '),
  () => {
    // given
    const directory = join(tmpdir(), `crust-test-configured-${process.pid}`)
    const config = { defaults: { data_dir: directory } }
    // when
    const actual = resolveDataPaths(config, process.cwd())
    // then
    expect(actual).toEqual({
      dataDir: directory,
      db: join(directory, 'crust.db'),
    })
  },
)

for (const [name, resolve] of [
  ['machine', machineConfigDirFromEnv],
  ['package', packageConfigDirFromEnv],
] as const) {
  test(
    [
      `given the ${name} configuration preload`,
      'when the layer directory is resolved',
      'it should point at a distinct missing scratch directory',
    ].join(', '),
    () => {
      // given
      // when
      const actual = resolve()
      // then
      expect(actual).toStartWith(tmpdir())
      expect(existsSync(actual ?? '')).toBe(false)
      expect(machineConfigDirFromEnv()).not.toBe(packageConfigDirFromEnv())
    },
  )
}
