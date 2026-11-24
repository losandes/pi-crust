#!/usr/bin/env bun
import { safeParseSettlement } from '../../lib/typedefs'
import { loadConfig } from '../domains/config'
import { resolveTraceListing } from '../domains/trace'
import { repoRoot, resolveDataPaths } from '../domains/workspace'
import { DEFAULT_CONFIG_PATH, DEFAULT_DB } from '../lib/contracts'
import { configPathFromEnv } from '../lib/system'

const USAGE =
  'usage: bun runtime/commands/trace.ts [--config <path>] <sessions|activity-runs|tail|procs> [<run-id>]'

export const main = (argv: readonly string[]): number => {
  const at = argv.indexOf('--config')
  const args =
    at < 0 ? argv : argv.filter((_, index) => index !== at && index !== at + 1)
  const [listing, runId] = args
  if (
    !(
      listing === 'sessions' ||
      listing === 'activity-runs' ||
      listing === 'tail' ||
      listing === 'procs'
    ) ||
    (listing !== 'sessions' && !runId)
  ) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  const configPath =
    (at < 0 ? undefined : argv[at + 1]) ??
    configPathFromEnv() ??
    DEFAULT_CONFIG_PATH
  const config = safeParseSettlement(() => loadConfig(configPath))
  const path =
    config.status === 'ok'
      ? resolveDataPaths(config.data, repoRoot()).db
      : DEFAULT_DB
  const result = resolveTraceListing(path)(listing, runId)
  if (result.status === 'error') {
    process.stderr.write(`trace: ${result.error.message}\n`)
    return 1
  }
  result.data.forEach((line) => {
    process.stdout.write(`${line}\n`)
  })
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
