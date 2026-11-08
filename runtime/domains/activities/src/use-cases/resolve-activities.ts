/**
 * Resolving Activity names into activities, against the registry a run loaded.
 *
 * There is no registry in this file any more. `STEP_REGISTRY` was a table of
 * names to factories, which meant a team could add an agent and never reach
 * it: nothing bound a activity to it. The table is `crust.activities.yaml` now,
 * and this resolves names against whatever that file turned out to hold.
 *
 * An unknown name must still fail loudly and list what was available — a
 * silently dropped Activity would make a chain quietly shorter than the
 * developer asked for.
 */

import type {
  TActivity,
  TActivityOptions,
  TPiCrustConfig,
  TTerminalConfig,
} from '../../../../lib/contracts'
import {
  DEFAULT_ACTIVITY_OPTIONS,
  isPlannerName,
  isTerminalName,
} from '../../../../lib/contracts'
import type { TResolvedActivity } from './activity-registry'
import {
  canonicalActivityNames,
  resolveActivities,
  resolvedNamed,
} from './activity-registry'
import { agentActivity } from './agent-activity'
import type { TAgentPorts } from './execute-agent'
import type { TTerminalActivity } from './gh-pull-request'
import { ghPullRequestActivity } from './gh-pull-request'
import { plannerActivity } from './planner-activity'

export { agentActivity } from './agent-activity'
export { plannerActivity } from './planner-activity'

/** Agents every chosen activity needs, deduplicated — checked before any spawn. */
export const requiredAgents = (
  activities: readonly TActivity[],
): readonly string[] => [
  ...new Set(activities.flatMap((activity) => activity.requires)),
]

export const unknownActivities = (
  names: readonly string[],
  registry: readonly TResolvedActivity[],
): readonly string[] =>
  canonicalActivityNames(
    registry.map((one) => one.config),
    names,
  ).filter(
    (name) =>
      !(isPlannerName(name) || isTerminalName(name)) &&
      resolvedNamed(registry, name) === undefined,
  )

/**
 * The terminal Activity a Lifecycle named, built and ready for `runTerminal`.
 *
 * It is never resolved through `runnableActivities` — nothing in the fold
 * may ever hold one, which is exactly what `TTerminalActivity` (distinct from
 * `TActivity`) exists to make a type error rather than a runtime surprise.
 */
export const terminalActivityFor = (
  name: string,
  cfg: TPiCrustConfig,
  options: TActivityOptions,
): TTerminalActivity => {
  const config = cfg.terminal.find((one) => one.name === name)
  if (config === undefined) {
    throw new Error(
      `terminal Activity '${name}' has no entry under terminal: in ` +
        'crust.activities.yaml, so it has no prompts to run with',
    )
  }

  return ghPullRequestActivity(config as TTerminalConfig, options)
}

/** The Activities a run may name, in the order the registry declares them. */
export const offeredActivities = (cfg: TPiCrustConfig): readonly string[] =>
  cfg.activities.map((one) => one.name)

/**
 * Resolve names to activities, numbering repeats so their activityRun names stay
 * unique.
 *
 * A repeated Activity is legitimate — `build, review, build, review` is a fix
 * loop written out longhand — and the second occurrence becomes `build_2`,
 * which is also the instance its attempt budget is kept against.
 */
export const runnableActivities = (
  names: readonly string[],
  cfg: TPiCrustConfig,
  options: Readonly<Partial<TActivityOptions>> = {},
  /**
   * Defaults to `agentActivity`'s own `liveAgent`. Exists so a test can
   * drive a real (unresumed) Activity Run through a canned, in-process
   * response — never a real `pi` spawn — the seam COVERAGE-AGENT-PORTS.md
   * built and said run-workflow.ts would go on to consume.
   */
  ports?: TAgentPorts,
): readonly TActivity[] => {
  const registry = resolveActivities(cfg.activities)
  const canonical = canonicalActivityNames(cfg.activities, names)
  const unknown = unknownActivities(canonical, registry)
  if (unknown.length > 0) {
    throw new Error(
      `unknown activity(s): ${unknown.join(', ')} — this repository offers ` +
        `${registry.map((one) => one.config.name).join(', ')}`,
    )
  }

  return canonical.map((name, index) => {
    const at = {
      ...DEFAULT_ACTIVITY_OPTIONS,
      ...options,
      instance:
        canonical.slice(0, index).filter((seen) => seen === name).length + 1,
    }
    if (isTerminalName(name)) {
      throw new Error(
        `'${name}' is a terminal Activity — the engine runs it once the ` +
          'chain has settled, after runReviseLoop and before finish. Nothing ' +
          'in the fold resolves it.',
      )
    }
    if (!isPlannerName(name)) {
      return agentActivity(
        resolvedNamed(registry, name) as TResolvedActivity,
        at,
        ports,
      )
    }
    const planner = cfg.planners.find((one) => one.name === name)
    if (planner === undefined) {
      throw new Error(
        `planner '${name}' has no entry under planners: in ` +
          'crust.activities.yaml, so it has no prompts to run with',
      )
    }

    return plannerActivity(planner, at)
  })
}
