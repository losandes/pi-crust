import type { TPiCrustConfig, TStage } from '../../../../lib/contracts'
import { lifecycleNamed, stagePlan } from '../../../../lib/contracts'
import { loadLifecycles, parseActivities } from '../..'

/**
 * A bad chain is a USAGE error (exit 2), not a failed run (exit 1).
 *
 * It is settled in `main` rather than thrown, because `runCli` turns any throw
 * from a handler into exit 1 — and something will branch on the difference
 * between "you asked for an Activity that does not exist" and "the run
 * failed".
 */
/**
 * The plan to run, from whichever way the caller said it.
 *
 * Stages, not a flat list. A Lifecycle keeps the arrangement it declared, and
 * `--activities a,b,c` becomes the one serial Stage it has always meant, and
 * `a,b+c` becomes two — so both spellings reach the engine as the same kind
 * of thing, and the engine never has to ask which way it was asked for.
 */
export const plannedActivities = (
  args: Readonly<{
    lifecycle: string | undefined
    activities: string | undefined
  }>,
  cfg: TPiCrustConfig,
  lifecyclesPath?: string,
): readonly TStage[] => {
  if (args.lifecycle !== undefined && args.activities !== undefined) {
    throw new Error(
      'name a lifecycle or list the activities, not both — ' +
        `got --lifecycle ${args.lifecycle} and --activities ${args.activities}`,
    )
  }
  if (args.lifecycle === undefined && args.activities === undefined) {
    throw new Error(
      'name what to run: --lifecycle <name> for a configured Lifecycle, or ' +
        '--activities a,b,c for a chain of your own (a+b runs two at once). ' +
        '`just crust list` prints both.',
    )
  }
  if (args.lifecycle === undefined) {
    return parseActivities(args.activities, cfg.activities)
  }
  const lifecycles = loadLifecycles(lifecyclesPath, cfg)
  const found = lifecycleNamed(lifecycles, args.lifecycle)
  if (found === undefined) {
    throw new Error(
      `unknown lifecycle: ${args.lifecycle} — this repository offers ` +
        `${lifecycles.map((one) => one.name).join(', ')}`,
    )
  }
  const stages = stagePlan(found)
  if (stages.every((stage) => stage.activities.length === 0)) {
    throw new Error(
      `lifecycle '${args.lifecycle}' declares no activities to run`,
    )
  }
  return stages
}
