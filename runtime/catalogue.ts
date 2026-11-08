#!/usr/bin/env bun

/**
 * pi-crust List — what this repository offers, read from its configuration.
 *
 * Usage:
 *     just crust list [--config <path>]
 *
 * `just crust default` used to answer this, because there was a recipe per
 * Activity and per Lifecycle. That list was a second copy of the registry,
 * written by hand in a file configuration cannot reach, and it drifted in the
 * direction nobody notices: four Lifecycles were added and the recipes went
 * on offering three.
 *
 * So the recipes stopped naming them and this reads the registry instead.
 * Add an Activity to `crust.activities.yaml` — or to the local layer beside
 * it — and it appears here, with no change to this package.
 *
 * Exit codes:
 *     0  printed
 *     2  the configuration could not be read
 */

import { errorMessage } from '../lib/typedefs/src/settlement'
import { catalogueOf, renderCatalogue } from './domains/cli'
import { DEFAULT_CONFIG_PATH, EXIT } from './lib/contracts'
import { configPathFromEnv } from './lib/system'
import { writeLine } from './lib/terminal'
export const USAGE =
  `usage: just crust list [--config <path>]\n` +
  'env: CRUST_CONFIG overrides the config path; the flag still wins.'

export const main = (argv: readonly string[]): number => {
  const at = argv.indexOf('--config')
  const configPath =
    (at === -1 ? undefined : argv[at + 1]) ??
    configPathFromEnv() ??
    DEFAULT_CONFIG_PATH
  writeLine(renderCatalogue(catalogueOf(configPath)))

  return EXIT.SUCCESS
}

/** A rejection from `main` is a usage error, reported the same way other CLI entries do. */
export const reportUsageError = (error: unknown): number => {
  process.stderr.write(`${errorMessage(error)}\n${USAGE}\n`)
  return EXIT.USAGE
}

if (import.meta.main) {
  // biome-ignore lint/plugin/no-intermediate-try-catch: this is the process boundary itself \u2014 there is no settlement layer above it to hand the error to
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    process.exit(reportUsageError(error))
  }
}
