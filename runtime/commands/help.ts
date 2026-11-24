import { reportUsageError, topicOf } from '../domains/cli'

/**
 * pi-crust Help — every recipe, every flag, and what this repo can run.
 *
 * Usage:
 *     crust help [<recipe>] [--config <path>]
 *
 * `crust list` already answers "what can this repository run" from its
 * own configuration. This answers the other half — every `crust`
 * recipe's signature, flags, environment variables and a worked example —
 * and contains `list`'s own output verbatim, so a developer never has to ask
 * an agent how to drive pi-crust. `crust help <recipe>` narrows the
 * reference to one recipe.
 *
 * Unlike every other entry point here, a configuration that fails to load is
 * NOT a usage error: the recipe reference needs no configuration at all, and
 * a developer whose selected TOML file is malformed, or whose explicit path
 * is missing, is exactly the developer reaching for help.
 *
 * Exit codes:
 *     0  printed (even with no configuration)
 *     2  an unknown recipe was named
 */

import { errorMessage, safeParseSettlement } from '../../lib/typedefs'
import {
  catalogueOf,
  RECIPE_DOCS,
  recipeDoc,
  renderCommandList,
  renderHelp,
} from '../domains/cli'
import { DEFAULT_CONFIG_PATH, EXIT } from '../lib/contracts'
import { configPathFromEnv } from '../lib/system'
import { writeLine } from '../lib/terminal'

const USAGE =
  'usage: crust help [<recipe>] [--config <path>]\n' +
  'env: CRUST_CONFIG overrides the config path; the flag still wins.'

const unknownTopicMessage = (topic: string): string =>
  `help: no such recipe "${topic}".\n` +
  `  documented recipes: ${RECIPE_DOCS.map((doc) => doc.name).join(', ')}\n`

export const main = (argv: readonly string[]): number => {
  if (argv.includes('--commands')) {
    writeLine(renderCommandList(RECIPE_DOCS))
    return EXIT.SUCCESS
  }
  // biome-ignore lint/plugin/no-intermediate-try-catch: main is the process boundary that maps usage failures to an exit code
  try {
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
  } catch (error) {
    return reportUsageError(USAGE)(error)
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
