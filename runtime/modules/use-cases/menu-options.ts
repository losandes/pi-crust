/**
 * What the interactive menu offers, derived from what is registered.
 *
 * It used to be three hardcoded lists: the lifecycles, the planners, and
 * every step name. Hardcoding drifted, silently and in the direction that
 * matters — the menu's `sdlc` ran design before plan, and its `bugfix`
 * opened with `identify`, while the recipes of the same name ran neither.
 * A menu that offers a chain nobody can run by any other route is worse
 * than no menu.
 *
 * So: lifecycles come from `crust.lifecycles.yaml` and Activities from
 * `crust.activities.yaml`, each in the order of its file. Something that
 * exists is offered; something offered exists.
 *
 * An entry is named for the WORK — `plan`, `build` — because that is what a
 * Lifecycle names and what the menu's values become. There is no second
 * namespace of performers to bridge any more: the Activity IS the agent.
 */

import type { TActivityConfig } from '../typedefs/activity'
import { activityOrder, type TLifecycleConfig } from '../typedefs/lifecycle'

/**
 * The Planners, which are capabilities rather than Activities.
 *
 * Triage recommends a chain and stops. The Operator recommends one and runs
 * it. Both decide what should happen, so neither is something a person picks
 * alongside the work — and neither can be added by configuration, which is
 * why this list is here rather than in a file a team edits.
 *
 * The Composer is absent deliberately: it executes a plan it is handed, and
 * the menu IS the thing that hands it one.
 */
export const PLANNERS = [
  {
    name: 'operator',
    summary: 'it picks the smallest chain that can produce the outcome',
  },
] as const

export type TMenuOption = Readonly<{
  value: string
  label: string
  detail: string
}>

/** `@` a lifecycle, `!` a planner, bare an activity. */
export const LIFECYCLE_MARK = '@'
export const PLANNER_MARK = '!'

/** Lifecycles first, then planners, then the work a person may pick. */
export const menuOptions = (
  activities: readonly TActivityConfig[],
  lifecycles: readonly TLifecycleConfig[],
): readonly TMenuOption[] => [
  ...lifecycles.map((lifecycle) => ({
    value: `${LIFECYCLE_MARK}${lifecycle.name}`,
    label: lifecycle.name,
    detail: lifecycle.description,
  })),
  ...PLANNERS.map((planner) => ({
    value: `${PLANNER_MARK}${planner.name}`,
    label: `${planner.name} — let it choose`,
    detail: planner.summary,
  })),
  ...activities
    .filter((activity) => !activity.hidden)
    .map((activity) => ({
      value: activity.name,
      label: `  ${activity.name}`,
      detail: activity.purpose,
    })),
]

/**
 * How many leading options answer the whole question on their own.
 *
 * A lifecycle names the chain and a planner chooses it, so either one is a
 * complete answer and cannot be combined with anything. Counting them rather
 * than listing indices keeps the exclusion correct when a team adds or
 * removes a lifecycle.
 */
export const exclusiveCount = (
  lifecycles: readonly TLifecycleConfig[],
): number => lifecycles.length + PLANNERS.length

/** The planner chosen, or '' when the chain was named or picked by hand. */
export const chosenPlanner = (chosen: readonly string[]): string =>
  chosen
    .filter((choice) => choice.startsWith(PLANNER_MARK))
    .map((choice) => choice.slice(1))[0] ?? ''

/** The lifecycle chosen, or '' when Activities were picked by hand. */
export const chosenLifecycle = (chosen: readonly string[]): string =>
  chosen
    .filter((choice) => choice.startsWith(LIFECYCLE_MARK))
    .map((choice) => choice.slice(1))[0] ?? ''

/**
 * A chosen lifecycle becomes the Activities it runs; a chosen Activity is
 * itself.
 *
 * The expansion goes through the same `activityOrder` the Composer uses, so
 * the menu cannot offer an order the runner would not produce.
 */
export const expandChoices = (
  chosen: readonly string[],
  lifecycles: readonly TLifecycleConfig[],
): readonly string[] =>
  chosen.flatMap((choice) => {
    if (choice.startsWith(PLANNER_MARK)) {
      return []
    }
    if (!choice.startsWith(LIFECYCLE_MARK)) {
      return [choice]
    }
    const named = lifecycles.find(
      (lifecycle) => lifecycle.name === choice.slice(1),
    )

    return named === undefined ? [] : activityOrder(named)
  })
