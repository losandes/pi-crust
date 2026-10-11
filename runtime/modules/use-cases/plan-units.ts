/**
 * Turn the Stages a caller asked for into the Units the driver runs.
 *
 * This is the only place the Stage boundary becomes execution. A serial Stage
 * contributes one Unit per Activity; a concurrent Stage contributes one Unit
 * holding all of them. Everything downstream — gates, context composition,
 * what the trace records — follows from that and needs no further knowledge
 * of strategies.
 *
 * An Activity a Stage names and the step registry does not have is dropped
 * rather than refused. Refusing belongs upstream, where the Lifecycle was
 * validated against the roster and the registry; by the time a plan reaches
 * here the names have already been resolved into steps, and a missing one
 * would mean the resolver silently disagreed with itself.
 */

import type { TStage } from '../typedefs/lifecycle'
import type { TStep } from '../typedefs/step'
import type { TUnit } from '../typedefs/unit'

export const unitsFrom = (
  stages: readonly TStage[],
  steps: readonly TStep[],
): readonly TUnit[] => {
  const byName = new Map(steps.map((step) => [step.name as string, step]))
  const resolve = (names: readonly string[]): readonly TStep[] =>
    names.flatMap((name) => {
      const step = byName.get(name)

      return step === undefined ? [] : [step]
    })

  return stages.flatMap((stage): readonly TUnit[] => {
    const members = resolve(stage.activities)
    if (members.length === 0) {
      return []
    }

    return stage.strategy === 'concurrent'
      ? [
          {
            stage: stage.name,
            strategy: stage.strategy,
            steps: members,
            endsStage: true,
          },
        ]
      : members.map((step, at) => ({
          stage: stage.name,
          strategy: stage.strategy,
          steps: [step],
          endsStage: at === members.length - 1,
        }))
  })
}

/** The Activities a plan runs, flattened, for the callers that need a list. */
export const plannedNames = (stages: readonly TStage[]): readonly string[] =>
  stages.flatMap((stage) => stage.activities)

/** A bare list of Activities, as the one serial Stage it is. */
export const asSingleStage = (names: readonly string[]): readonly TStage[] =>
  names.length === 0
    ? []
    : [{ name: 'steps', strategy: 'serial', activities: [...names] }]
