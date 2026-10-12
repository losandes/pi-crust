/**
 * Turn the Stages a caller asked for into the Units the driver runs.
 *
 * This is the only place the Stage boundary becomes execution. A serial Stage
 * contributes one Unit per Activity; a concurrent Stage contributes one Unit
 * holding all of them. Everything downstream — gates, context composition,
 * what the trace records — follows from that and needs no further knowledge
 * of strategies.
 *
 * An Activity a Stage names and the activity registry does not have is dropped
 * rather than refused. Refusing belongs upstream, where the Lifecycle was
 * validated against the roster and the registry; by the time a plan reaches
 * here the names have already been resolved into activities, and a missing one
 * would mean the resolver silently disagreed with itself.
 */

import type { TStage } from '../typedefs/lifecycle'
import type { TActivity } from '../typedefs/runnable-activity'
import type { TUnit } from '../typedefs/unit'

export const unitsFrom = (
  stages: readonly TStage[],
  activities: readonly TActivity[],
): readonly TUnit[] => {
  const byName = new Map(
    activities.map((activity) => [activity.name as string, activity]),
  )
  const resolve = (names: readonly string[]): readonly TActivity[] =>
    names.flatMap((name) => {
      const activity = byName.get(name)

      return activity === undefined ? [] : [activity]
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
            activities: members,
            endsStage: true,
          },
        ]
      : members.map((activity, at) => ({
          stage: stage.name,
          strategy: stage.strategy,
          activities: [activity],
          endsStage: at === members.length - 1,
        }))
  })
}

/** The Activities a plan runs, flattened, for the callers that need a list. */
export const plannedNames = (stages: readonly TStage[]): readonly string[] =>
  stages.flatMap((stage) => stage.activities)

/**
 * A bare list of Activities, as the one serial Stage it is.
 *
 * The Stage takes its name from its members, because nothing a caller passes
 * names it and the name reaches the trace and the UI. It used to be the
 * literal `activities`, which told a reader of a run nothing about what ran.
 */
export const asSingleStage = (names: readonly string[]): readonly TStage[] =>
  names.length === 0
    ? []
    : [
        {
          name:
            names.length === 1
              ? (names[0] ?? '')
              : `${names[0] ?? ''}..${names.at(-1) ?? ''}`,
          strategy: 'serial',
          activities: [...names],
        },
      ]
