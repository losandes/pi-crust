/**
 * The command a developer types, composed in one place.
 *
 * Everything pi-crust prints for a person to run is a `just crust` recipe.
 * The alternative — the `bun <path>` line that actually executes — names an
 * install directory, and since the runtime left the stamp there is no install
 * directory a relative path can reach: `.pi-crust/` holds `config/`, `data/`
 * and `prompts/` and nothing else. A printed path there is a
 * command that cannot run, on the one output whose whole job is to be pasted.
 *
 * So the mapping from an entry point to its recipe lives here, used by the
 * reporter and by the command builder, rather than being spelled out at each
 * site that prints something.
 */

import { basename } from 'node:path'

/**
 * The recipe that runs a chain, named once.
 *
 * Every other entry point is a capability with a recipe of the same name;
 * this is the one whose recipe name and file name differ, because the file is
 * the Composer — engine vocabulary — and the recipe is what a developer does.
 */
export const RUN_RECIPE = 'run'

/** Entry point file name (without `.ts`) -> the recipe in front of it. */
const RECIPE_OF: Readonly<Record<string, string>> = {
  run: RUN_RECIPE,
  operator: 'operator',
  triage: 'triage',
}

/** The recipe for an entry point path, or undefined if nothing runs it. */
export const recipeOf = (script: string): string | undefined =>
  RECIPE_OF[basename(script).replace(/\.ts$/, '')]

/**
 * A recorded `[bun, <entry>, ...args]` as the recipe that reproduces it.
 *
 * The arguments are carried verbatim. They were parsed once already, by the
 * run that recorded them, and re-deriving them here would be a second parser
 * to keep in activity with the first.
 */
export const recipeArgv = (
  argv: readonly string[],
): readonly string[] | undefined => {
  const script = argv[1]
  if (script === undefined) return undefined
  const recipe = recipeOf(script)

  return recipe === undefined
    ? undefined
    : ['just', 'crust', recipe, ...argv.slice(2)]
}

/**
 * The command as a person would type it.
 *
 * Quoting is deliberately minimal: a quote around every argument is noise
 * that hides the one argument that genuinely needed quoting.
 */
export const shellLine = (argv: readonly string[]): string =>
  argv
    .map((part) => (/^[\w.,+/=:-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(' ')
