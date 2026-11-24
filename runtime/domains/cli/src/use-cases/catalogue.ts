/**
 * pi-crust List — what this repository offers, read from its configuration.
 *
 * `crust default` used to answer this, because there was a recipe per
 * Activity and per Lifecycle. That list was a second copy of the registry,
 * written by hand in a file configuration cannot reach, and it drifted in the
 * direction nobody notices: four Lifecycles were added and the recipes went
 * on offering three.
 *
 * So the recipes stopped naming them and this reads the registry instead.
 * A new Activity table in any TOML layer appears here without a second registry.
 */

import type { TEnv } from '../../../../lib/system'
import { paint } from '../../../../lib/terminal'
import { loadConfig } from '../../../config'
import { loadLifecycles } from '../../../planning'
import { PLANNERS } from './menu-options'
import { RUN_RECIPE } from './recipe-line'

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
          (entry) =>
            `  ${entry.name.padEnd(width)}  ${paint(entry.detail, 'dim')}`,
        )),
  ]

  return [
    ...section(
      'lifecycles',
      `crust ${RUN_RECIPE} "<prompt>" --lifecycle <name>`,
      catalogue.lifecycles,
    ),
    ...section(
      'planners',
      'crust <name> "<prompt>"  — they choose the chain',
      catalogue.planners,
    ),
    ...section(
      'activities',
      `crust ${RUN_RECIPE} "<prompt>" --activities a,b,c   (a+b runs at once)`,
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

export const catalogueOf = (
  configPath: string,
  env: TEnv = process.env,
): TCatalogue => {
  const cfg = loadConfig(configPath, env)

  return {
    lifecycles: loadLifecycles(cfg).map((lifecycle) => ({
      name: lifecycle.name,
      detail: lifecycle.description,
    })),
    /*
     * Every Planner, not only the ones the interactive menu offers. `triage`
     * has a recipe and chooses a chain; a list of what this repository can
     * run that left it out would be answering a different question.
     */
    planners: cfg.planners.map(({ name }) => ({
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
