/**
 * The Activity registry, resolved: configuration becomes something runnable.
 *
 * `crust.activities.yaml` names an envelope spec and some gates. This is
 * where those names become the spec and the gates themselves, and where a
 * name nothing publishes is refused — at load, naming what was available,
 * because that refusal is what replaces the compiler's old union of activity
 * names. An unknown Activity used to be a type error; it is now this.
 */

import type { TActivityConfig } from '../typedefs/activity'
import {
  isPlannerName,
  isTerminalName,
  PLANNER_NAMES,
  TERMINAL_NAMES,
} from '../typedefs/activity'
import type { TEnvelopeBase, TEnvelopeSpec } from '../typedefs/envelope'
import { ENVELOPE_NAMES, envelopeNamed } from '../typedefs/envelope'
import type { TGate } from '../typedefs/gate'
import { GATE_NAMES, gateNamed } from './gates'

/** What a activity is built from: the entry, with its names resolved. */
export type TResolvedActivity = Readonly<{
  config: TActivityConfig
  spec: TEnvelopeSpec<TEnvelopeBase>
  gates: readonly TGate[]
}>

/** Where an Activity's `previous` envelope comes from. */
export const INPUT_NAMES = ['upstream', 'changes'] as const
export type TActivityInput = (typeof INPUT_NAMES)[number]

export const isActivityInput = (name: string): name is TActivityInput =>
  (INPUT_NAMES as readonly string[]).includes(name)

/** Everything wrong with one entry, in the words a developer can act on. */
export const activityFaults = (
  activity: TActivityConfig,
): readonly string[] => {
  const output =
    envelopeNamed(activity.output) === undefined
      ? [
          `activity '${activity.name}': output '${activity.output}' is not an ` +
            `envelope this package publishes — available: ${ENVELOPE_NAMES.join(', ')}`,
        ]
      : []
  const gates = activity.gates.flatMap((name) =>
    gateNamed(name) === undefined
      ? [
          `activity '${activity.name}': gate '${name}' is not a gate this ` +
            `package publishes — available: ${GATE_NAMES.join(', ')}`,
        ]
      : [],
  )
  const input = isActivityInput(activity.input)
    ? []
    : [
        `activity '${activity.name}': input '${activity.input}' is not an ` +
          `input this package publishes — available: ${INPUT_NAMES.join(', ')}`,
      ]
  /*
   * A Planner is not an Activity and may not be named by a Lifecycle, so an
   * entry claiming one of their names would make it nameable through the
   * back door.
   */
  const planner = isPlannerName(activity.name)
    ? [
        `activity '${activity.name}': that is a Planner, not an Activity — ` +
          `the Planners are ${PLANNER_NAMES.join(', ')} and are configured ` +
          'under planners:, where a Lifecycle cannot name them',
      ]
    : []
  /*
   * A terminal Activity is not an Activity either, for the same reason: it is
   * wired into the engine and runs after the chain settles, not somewhere a
   * Lifecycle names it mid-chain.
   */
  const terminal = isTerminalName(activity.name)
    ? [
        `activity '${activity.name}': that is a terminal Activity, not an ` +
          `Activity — the terminal Activities are ${TERMINAL_NAMES.join(', ')} ` +
          'and are configured under terminal:, where a Lifecycle may only name ' +
          'them last',
      ]
    : []

  return [...planner, ...terminal, ...output, ...gates, ...input]
}

export const registryFaults = (
  activities: readonly TActivityConfig[],
): readonly string[] => {
  const duplicates = activities
    .map((one) => one.name)
    .filter((name, at, all) => all.indexOf(name) !== at)
    .map(
      (name) =>
        `activity '${name}' is registered twice — a Lifecycle naming it ` +
        'could not say which one it meant',
    )

  return [...duplicates, ...activities.flatMap(activityFaults)]
}

/**
 * The registry, runnable, or a refusal naming everything that is wrong.
 *
 * Every fault at once rather than the first: a team adding three Activities
 * should not discover their mistakes one run at a time.
 */
export const resolveActivities = (
  activities: readonly TActivityConfig[],
): readonly TResolvedActivity[] => {
  const faults = registryFaults(activities)
  if (faults.length > 0) {
    throw new Error(
      `the Activity registry cannot run:\n- ${faults.join('\n- ')}`,
    )
  }

  return activities.map((config) => ({
    config,
    spec: envelopeNamed(config.output) as TEnvelopeSpec<TEnvelopeBase>,
    gates: config.gates.map((name) => gateNamed(name) as TGate),
  }))
}

export const resolvedNamed = (
  resolved: readonly TResolvedActivity[],
  name: string,
): TResolvedActivity | undefined =>
  resolved.find((one) => one.config.name === name)
