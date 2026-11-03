#!/usr/bin/env bun

/**
 * Print the resolved trace database path for the config in force.
 *
 * `crust.just`'s `db` variable calls this (1.6.5) instead of assuming
 * `.pi-crust/data/crust.db`: the recipes that read it — `sessions`,
 * `activity-runs`, `tail`, `procs` and `observe` — must agree with every
 * other reader of `observability.db` about where a relocated or pooled store
 * actually is.
 *
 * Usage: bun print-db-path.ts [--config <path>]
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../lib/typedefs/src/settlement'
import { resolveDataPaths } from './modules/data/data-paths'
import { configPathFromEnv } from './modules/data/env-overrides'
import { repoRoot } from './modules/data/git'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { loadConfig } from './modules/use-cases/load-config'

const flagValue = (
  argv: readonly string[],
  flag: string,
): string | undefined => {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

export const main = (argv: readonly string[]): number => {
  const configPath =
    flagValue(argv, '--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH
  const cfg = safeParseSettlement(() => loadConfig(configPath))
  if (cfg.status !== 'ok') {
    process.stderr.write(`print-db-path: ${errorMessage(cfg.error)}\n`)
    return 1
  }
  process.stdout.write(`${resolveDataPaths(cfg.data, repoRoot()).db}\n`)
  return 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
