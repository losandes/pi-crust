#!/usr/bin/env bun
import {
  catalogueOf,
  LIST_USAGE,
  renderCatalogue,
  reportUsageError,
} from '../domains/cli'

/**
 * pi-crust List — what this repository offers, read from its configuration.
 *
 * Usage:
 *     crust list [--config <path>]
 *
 * `crust default` used to answer this, because there was a recipe per
 * Activity and per Lifecycle. That list was a second copy of the registry,
 * written by hand in a file configuration cannot reach, and it drifted in the
 * direction nobody notices: four Lifecycles were added and the recipes went
 * on offering three.
 *
 * So the recipes stopped naming them and this reads the registry instead.
 * A new Activity table in any TOML layer appears here without a second registry.
 * Four shipped Lifecycles have a command again: gh-issue, ship, ship-plan and
 * ship-outcome. Each definition names only its Lifecycle; run resolves the
 * Stages from configuration rather than keeping a second Stage list.
 *
 * Exit codes:
 *     0  printed
 *     2  the configuration could not be read
 */

import { DEFAULT_CONFIG_PATH, EXIT } from '../lib/contracts'
import { configPathFromEnv } from '../lib/system'
import { writeLine } from '../lib/terminal'

export const main = (argv: readonly string[]): number => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: main is the process boundary that maps usage failures to an exit code
  try {
    const at = argv.indexOf('--config')
    const configPath =
      (at === -1 ? undefined : argv[at + 1]) ??
      configPathFromEnv() ??
      DEFAULT_CONFIG_PATH
    writeLine(renderCatalogue(catalogueOf(configPath)))

    return EXIT.SUCCESS
  } catch (error) {
    return reportUsageError(LIST_USAGE)(error)
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
