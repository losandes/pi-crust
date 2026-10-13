/**
 * The chain a developer spells out on the command line, as Stages.
 *
 * `--steps a,b,c` could only ever mean one serial Stage, so the one thing a
 * Lifecycle can express that a command line could not was concurrency: a
 * chain ending in `outcome-review` and `code-review` — the one concurrent Stage the
 * shipped Lifecycles have — ran them one after the other and said nothing.
 * Writing a file to get a grouping you can describe in four characters is the
 * gap this closes.
 *
 * The grammar is one flag and two separators:
 *
 *     --activities plan,build,test,outcome-review+code-review
 *
 * `,` ends a Stage. `+` joins Activities into ONE concurrent Stage. A run of
 * consecutive single-name groups folds into one serial Stage, so the old
 * spelling means exactly what it always meant.
 *
 * `+` rather than a character that reads better: it needs no shell quoting.
 * `|` is a pipe, `&` backgrounds the command, `()` and `[]` are subshell and
 * glob syntax — each of those makes the common case require quotes, and a
 * syntax that is wrong unquoted will be typed unquoted.
 */

import type { TActivityConfig } from '../typedefs/activity'
import { isPlannerName, PLANNER_NAMES } from '../typedefs/activity'
import type { TLifecycleConfig, TStage } from '../typedefs/lifecycle'
import { concurrencyFaults } from './concurrency-faults'

/** What a derived Stage is called when the developer named no Stage at all. */
const SERIAL_NAME = (members: readonly string[]): string =>
  members.length === 1
    ? (members[0] ?? '')
    : `${members[0] ?? ''}..${members.at(-1) ?? ''}`

/**
 * Where a refused chain says it came from.
 *
 * Nothing a developer types names a Stage, so a fault has to point at the
 * flag rather than at a Lifecycle that does not exist.
 */
export const ADHOC_LIFECYCLE = '--activities'

type TGroup = Readonly<{ names: readonly string[]; concurrent: boolean }>

const groupsOf = (value: string): readonly TGroup[] =>
  value
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => ({
      names: group
        .split('+')
        .map((name) => name.trim())
        .filter(Boolean),
      concurrent: group.includes('+'),
    }))
    .filter((group) => group.names.length > 0)

/**
 * Consecutive single-name groups become one serial Stage.
 *
 * Not one Stage each: a Stage is where the engine draws its boundary — gates
 * at the end of it, context composed across it — and turning `plan,build`
 * into two of them would change how a chain runs because of how it was
 * punctuated.
 */
const foldSerial = (groups: readonly TGroup[]): readonly TStage[] => {
  /*
   * Boundaries first, then one Stage per run. Folding with a spread would
   * rebuild the whole list on every group; the boundary is the only thing
   * that actually has to be decided in sequence, and it is a boolean.
   */
  const opensStage = (group: TGroup, at: number): boolean =>
    at === 0 || group.concurrent || (groups[at - 1]?.concurrent ?? false)
  const starts = groups.flatMap((group, at) => (opensStage(group, at) ? [at] : []))

  return starts.map((start, which) => {
    const end = starts[which + 1] ?? groups.length
    const members = groups.slice(start, end).flatMap((group) => group.names)
    const concurrent = groups[start]?.concurrent ?? false

    return concurrent
      ? { name: members.join('+'), strategy: 'concurrent', activities: members }
      : { name: SERIAL_NAME(members), strategy: 'serial', activities: members }
  })
}

/**
 * The names refused before anything starts, with the reason for each.
 *
 * Checked against what THIS repository offers rather than against a union in
 * the package: a team that removed an Activity must be told it is gone, and a
 * team that added one must be able to name it.
 */
const nameFaults = (
  names: readonly string[],
  offered: readonly string[],
): readonly string[] => {
  const planners = names.filter(isPlannerName)
  const unknown = names.filter(
    (name) => !(isPlannerName(name) || offered.includes(name)),
  )

  return [
    ...(planners.length > 0
      ? [
          `${planners.join(', ')} cannot be named in a chain — ` +
            `${PLANNER_NAMES.join(' and ')} CHOOSE a chain rather than being ` +
            'part of one. Run `just crust operator "…"` or ' +
            '`just crust triage "…"` instead.',
        ]
      : []),
    ...(unknown.length > 0
      ? [
          `unknown activity(s): ${unknown.join(', ')} — this repository ` +
            `offers ${offered.join(', ')}`,
        ]
      : []),
  ]
}

/**
 * A `--activities` value as the Stages it describes, or a throw naming why not.
 *
 * The concurrency check is the Lifecycle one, unchanged: a concurrent Stage
 * whose Activities declare overlapping `writes` is refused here exactly as it
 * is when a Lifecycle claims it, because `build+test` typed at a prompt and
 * `build+test` written in YAML are the same claim about the same tree.
 */
export const parseActivities = (
  value: string | undefined,
  activities: readonly TActivityConfig[],
): readonly TStage[] => {
  const offered = activities.map((one) => one.name)
  const groups = groupsOf(value ?? '')
  if (groups.length === 0) {
    throw new Error(
      '--activities is required: an ordered list, `,` between Stages and ' +
        '`+` between Activities that run at the same time. ' +
        `This repository offers ${offered.join(', ')}`,
    )
  }
  const faults = nameFaults(
    groups.flatMap((group) => group.names),
    offered,
  )
  if (faults.length > 0) {
    throw new Error(faults.join('\n'))
  }
  const stages = foldSerial(groups)
  const asLifecycle: TLifecycleConfig = {
    name: ADHOC_LIFECYCLE,
    description: 'a chain named on the command line',
    stages: stages.map((stage) => ({ ...stage, activities: [...stage.activities] })),
  }
  const collisions = concurrencyFaults(asLifecycle, activities)
  if (collisions.length > 0) {
    throw new Error(collisions.map((fault) => fault.message).join('\n'))
  }

  return stages
}
