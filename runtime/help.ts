#!/usr/bin/env bun

/**
 * pi-crust Help — every recipe, every flag, and what this repo can run.
 *
 * Usage:
 *     just crust help [<recipe>] [--config <path>]
 *
 * `just crust list` already answers "what can this repository run" from its
 * own configuration. This answers the other half — every `just crust`
 * recipe's signature, flags, environment variables and a worked example —
 * and contains `list`'s own output verbatim, so a developer never has to ask
 * an agent how to drive pi-crust. `just crust help <recipe>` narrows the
 * reference to one recipe.
 *
 * Unlike every other entry point here, a configuration that fails to load is
 * NOT a usage error: the recipe reference needs no configuration at all, and
 * a developer whose `.pi-crust/config/` is missing or malformed is exactly
 * the developer reaching for help.
 *
 * Exit codes:
 *     0  printed (even with no configuration)
 *     2  an unknown recipe was named
 */

import {
  errorMessage,
  safeParseSettlement,
} from '../lib/typedefs/src/settlement'
import { catalogueOf, RECIPE_DOCS, recipeDoc, renderHelp } from './domains/cli'
import { DEFAULT_CONFIG_PATH, EXIT } from './lib/contracts'
import { configPathFromEnv } from './lib/system'
import { writeLine } from './lib/terminal'
export const USAGE =
  'usage: just crust help [<recipe>] [--config <path>]\n' +
  'env: CRUST_CONFIG overrides the config path; the flag still wins.'

/**
 * The topic, ignoring `--config` and its value: the `help` recipe always
 * passes `--config {{config}}`, so the first remaining positional argument
 * is the recipe a developer named, if any.
 */
export const topicOf = (argv: readonly string[]): string | undefined => {
  const at = argv.indexOf('--config')
  const withoutConfig =
    at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)]

  return withoutConfig.find((token) => !token.startsWith('-'))
}

const unknownTopicMessage = (topic: string): string =>
  `help: no such recipe "${topic}".\n` +
  `  documented recipes: ${RECIPE_DOCS.map((doc) => doc.name).join(', ')}\n`

export const main = (argv: readonly string[]): number => {
  const at = argv.indexOf('--config')
  const configPath =
    (at === -1 ? undefined : argv[at + 1]) ??
    configPathFromEnv() ??
    DEFAULT_CONFIG_PATH

  const topicName = topicOf(argv)
  if (topicName !== undefined) {
    const topic = recipeDoc(topicName)
    if (topic === undefined) {
      process.stderr.write(unknownTopicMessage(topicName))

      return EXIT.USAGE
    }
    writeLine(
      renderHelp({ catalogue: undefined, catalogueNote: undefined, topic }),
    )

    return EXIT.SUCCESS
  }

  const settled = safeParseSettlement(() => catalogueOf(configPath))
  writeLine(
    renderHelp(
      settled.status === 'ok'
        ? {
            catalogue: settled.data,
            catalogueNote: undefined,
            topic: undefined,
          }
        : {
            catalogue: undefined,
            catalogueNote: errorMessage(settled.error),
            topic: undefined,
          },
    ),
  )

  return EXIT.SUCCESS
}

if (import.meta.main) {
  // biome-ignore lint/plugin/no-intermediate-try-catch: this is the process boundary itself \u2014 there is no settlement layer above it to hand the error to
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n${USAGE}\n`)
    process.exit(EXIT.USAGE)
  }
}
