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
 * So: lifecycles come from `crust.lifecycles.yaml`, and the order is the
 * order of the file. Something that exists is offered; something offered
 * exists.
 *
 * A registry entry is named for the PERFORMER — `planner`, `builder` — and
 * the runnable unit is named for the WORK — `plan`, `build`. They are not
 * the same name, and the menu's values become `--steps`, so the menu lists
 * the work. `hidden` is declared on the performer and applies to the work it
 * owns, which is the only place a team can say it today; the two will have
 * to be reconciled when the orchestration model lands, and this is the seam
 * where that shows.
 */

import type { TActivityConfig } from '../typedefs/activity'
import { activityOrder, type TLifecycleConfig } from '../typedefs/lifecycle'
import { DEFAULT_STEP_OPTIONS, STEP_NAMES } from '../typedefs/step'
import { STEP_REGISTRY } from './steps'

/**
 * The Planners, which are capabilities rather than Activities.
 *
 * Triage recommends a lifecycle and stops. The Operator recommends one and
 * runs it. Both decide what should happen, so neither is something a person
 * picks alongside the work — and neither is configurable, which is why this
 * list is here rather than in a file a team edits.
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

const PLANNER_NAMES: readonly string[] = [
  ...PLANNERS.map((planner) => planner.name),
  'triage',
]

export type TMenuOption = Readonly<{
  value: string
  label: string
  detail: string
}>

/** `@` a lifecycle, `!` a planner, bare an activity. */
export const LIFECYCLE_MARK = '@'
export const PLANNER_MARK = '!'

/** Who performs a step, as the registry binds it. */
const ownerOf = (step: string): string =>
  STEP_REGISTRY[step as keyof typeof STEP_REGISTRY]?.(DEFAULT_STEP_OPTIONS)
    .requires[0] ?? ''

/** What a step is for, taken from the performer the registry binds it to. */
const purposeOf = (
  activities: readonly TActivityConfig[],
  step: string,
): string =>
  activities.find((activity) => activity.name === ownerOf(step))?.purpose ?? ''

/**
 * A step is hidden when the Activity that performs it is.
 *
 * A step with no performer — the deterministic ones, `verify` and `commit` —
 * is never hidden: there is no Activity to carry the flag, and a check a
 * team cannot hide is not a gap worth inventing a second mechanism for.
 */
const isHidden = (
  activities: readonly TActivityConfig[],
  step: string,
): boolean =>
  activities.find((activity) => activity.name === ownerOf(step))?.hidden ??
  false

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
  ...STEP_NAMES.filter(
    (step) => !(PLANNER_NAMES.includes(step) || isHidden(activities, step)),
  ).map((step) => ({
    value: step,
    label: `  ${step}`,
    detail: purposeOf(activities, step),
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
