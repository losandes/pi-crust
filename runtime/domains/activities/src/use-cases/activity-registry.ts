/**
 * The Activity registry, resolved: configuration becomes something runnable.
 *
 * `crust.activities.yaml` names an envelope spec and some gates. This is
 * where those names become the spec and the gates themselves, and where a
 * name nothing publishes is refused — at load, naming what was available,
 * because that refusal is what replaces the compiler's old union of activity
 * names. An unknown Activity used to be a type error; it is now this.
 */

import type {
  TActivityConfig,
  TEnvelopeBase,
  TEnvelopeSpec,
  TGate,
} from '../../../../lib/contracts'
import {
  activityNamed,
  ENVELOPE_NAMES,
  envelopeNamed,
  isImportName,
  isPlannerName,
  isTerminalName,
  PLANNER_NAMES,
  TERMINAL_NAMES,
} from '../../../../lib/contracts'
import { GATE_NAMES, gateNamed } from '../../../gates'

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

  const importing = isImportName(activity.name)
    ? [
        "activity 'import': that name is the engine's import step, not an Activity — a Lifecycle names it first to import referenced work, and configuration cannot define it",
      ]
    : []
  return [...importing, ...planner, ...terminal, ...output, ...gates, ...input]
}

/**
 * Every alias collision: against another Activity's name, against a
 * Planner's name, and against another entry's alias (or the entry's own,
 * declared twice). Alias-vs-alias compares against entries declared EARLIER
 * only, so one colliding pair produces one fault rather than two.
 */
const aliasFaults = (
  activities: readonly TActivityConfig[],
): readonly string[] =>
  activities.flatMap((activity, index) => {
    const earlier = activities.slice(0, index)

    return activity.aliases.flatMap((alias, aliasIndex) => {
      if (isImportName(alias)) {
        return [
          `activity '${activity.name}': alias 'import' is the engine's import step — configuration cannot make an Activity answer to it`,
        ]
      }
      const namesActivity = activities.find((one) => one.name === alias)
      if (namesActivity !== undefined) {
        return [
          `activity '${activity.name}': alias '${alias}' is the name of ` +
            `activity '${namesActivity.name}' — a chain naming it could not ` +
            'say which Activity it meant',
        ]
      }

      if (isPlannerName(alias)) {
        return [
          `activity '${activity.name}': alias '${alias}' is a Planner — the ` +
            `Planners are ${PLANNER_NAMES.join(', ')} and configuration cannot ` +
            'make one nameable in a chain',
        ]
      }

      const aliasedEarlier = earlier.find((one) => one.aliases.includes(alias))
      if (aliasedEarlier !== undefined) {
        return [
          `activity '${activity.name}': alias '${alias}' is already an alias ` +
            `of activity '${aliasedEarlier.name}' — one name cannot resolve to ` +
            'two Activities',
        ]
      }

      const declaredTwice = activity.aliases.indexOf(alias) !== aliasIndex
      if (declaredTwice) {
        return [`activity '${activity.name}': declares alias '${alias}' twice`]
      }

      return []
    })
  })

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

  return [
    ...aliasFaults(activities),
    ...duplicates,
    ...activities.flatMap(activityFaults),
  ]
}

/** An alias resolved to the Activity's own name; anything else, unchanged. */
export const canonicalActivityName = (
  activities: readonly TActivityConfig[],
  name: string,
): string =>
  activityNamed(activities, name) === undefined
    ? (activities.find((one) => one.aliases.includes(name))?.name ?? name)
    : name

export const canonicalActivityNames = (
  activities: readonly TActivityConfig[],
  names: readonly string[],
): readonly string[] =>
  names.map((name) => canonicalActivityName(activities, name))

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
