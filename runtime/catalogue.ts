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

import { configPathFromEnv } from './modules/data/env-overrides'
import { paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { EXIT } from './modules/typedefs/run-state'
import { errorMessage, safeParseSettlement } from './modules/typedefs/settlement'
import { loadConfig } from './modules/use-cases/load-config'
import {
  lifecyclesBeside,
  loadLifecycles,
} from './modules/use-cases/load-lifecycles'
import { PLANNER_NAMES } from './modules/typedefs/activity'
import { PLANNERS } from './modules/use-cases/menu-options'
import { RUN_RECIPE } from './modules/use-cases/recipe-line'

export const USAGE =
  `usage: just crust list [--config <path>]\n` +
  'env: CRUST_CONFIG overrides the config path; the flag still wins.'

export type TEntry = Readonly<{ name: string; detail: string }>

export type TCatalogue = Readonly<{
  lifecycles: readonly TEntry[]
  planners: readonly TEntry[]
  activities: readonly TEntry[]
  terminal: readonly TEntry[]
}>

/**
 * The catalogue, in the order each file declares.
 *
 * Hidden Activities are listed and marked rather than dropped. Hiding is a
 * preference about a menu; a list whose purpose is "what can I name" would be
 * lying if it left out something `--activities` still runs.
 */
export const renderCatalogue = (catalogue: TCatalogue): string => {
  const width = Math.max(
    ...[
      ...catalogue.lifecycles,
      ...catalogue.planners,
      ...catalogue.activities,
      ...catalogue.terminal,
    ].map((entry) => entry.name.length),
    4,
  )
  const section = (
    title: string,
    how: string,
    entries: readonly TEntry[],
  ): readonly string[] => [
    '',
    paint(title, 'bold'),
    paint(`  ${how}`, 'dim'),
    ...(entries.length === 0
      ? [paint('  (none)', 'dim')]
      : entries.map(
          (entry) => `  ${entry.name.padEnd(width)}  ${paint(entry.detail, 'dim')}`,
        )),
  ]

  return [
    ...section(
      'lifecycles',
      `just crust ${RUN_RECIPE} "<prompt>" --lifecycle <name>`,
      catalogue.lifecycles,
    ),
    ...section(
      'planners',
      'just crust <name> "<prompt>"  — they choose the chain',
      catalogue.planners,
    ),
    ...section(
      'activities',
      `just crust ${RUN_RECIPE} "<prompt>" --activities a,b,c   (a+b runs at once)`,
      catalogue.activities,
    ),
    ...section(
      'terminal',
      'named last in a Lifecycle; the engine runs it once the run has settled',
      catalogue.terminal,
    ),
    '',
  ].join('\n')
}

export const catalogueOf = (configPath: string): TCatalogue => {
  const cfg = loadConfig(configPath)

  return {
    lifecycles: loadLifecycles(lifecyclesBeside(configPath), cfg).map(
      (lifecycle) => ({
        name: lifecycle.name,
        detail: lifecycle.description,
      }),
    ),
    /*
     * Every Planner, not only the ones the interactive menu offers. `triage`
     * has a recipe and chooses a chain; a list of what this repository can
     * run that left it out would be answering a different question.
     */
    planners: PLANNER_NAMES.map((name) => ({
      name,
      detail:
        PLANNERS.find((planner) => planner.name === name)?.summary ??
        'it recommends a chain and stops, rather than running one',
    })),
    activities: cfg.activities.map((activity) => ({
      name: activity.name,
      detail: activity.hidden
        ? `${activity.purpose} (hidden from menus)`
        : activity.purpose,
    })),
    terminal: cfg.terminal.map((entry) => ({
      name: entry.name,
      detail: entry.purpose,
    })),
  }
}

export const main = (argv: readonly string[]): number => {
  const at = argv.indexOf('--config')
  const configPath =
    (at === -1 ? undefined : argv[at + 1]) ??
    configPathFromEnv() ??
    DEFAULT_CONFIG_PATH
  writeLine(renderCatalogue(catalogueOf(configPath)))

  return EXIT.SUCCESS
}

if (import.meta.main) {
  const settled = safeParseSettlement(() => main(process.argv.slice(2)))
  if (settled.status === 'error') {
    process.stderr.write(`${errorMessage(settled.error)}\n${USAGE}\n`)
    process.exit(EXIT.USAGE)
  }
  process.exit(settled.data)
}
