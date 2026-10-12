/**
 * The Activity catalogue a Planner plans from, generated rather than written.
 *
 * A Planner has to know what Activities exist and what each is for. Writing
 * that into its prompt would guarantee it is wrong: the day somebody adds an
 * Activity, the Planner keeps planning yesterday's factory and the mistake is
 * invisible — a plan that omits an Activity nobody told it about looks
 * exactly like a plan that chose not to use it.
 *
 * So it is built at render time from the registry the run loaded. An Activity
 * that exists is listed; an Activity that is listed exists. Planners are
 * absent, because a Planner cannot plan a Planner — offering one and then
 * rejecting it in the gate wastes an attempt teaching the agent something the
 * prompt could simply not have suggested.
 */

import type { TActivityConfig } from '../typedefs/activity'

/** One line per Activity: the name a plan must use, and what it does. */
export const stepCatalogue = (
  activities: readonly TActivityConfig[],
): string =>
  activities
    .map((activity) =>
      activity.purpose === ''
        ? `- \`${activity.name}\``
        : `- \`${activity.name}\` — ${activity.purpose}`,
    )
    .join('\n')
