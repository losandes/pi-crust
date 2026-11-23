/**
 * A Lifecycle: the progression of an objective, as configuration.
 *
 * A Lifecycle holds Stages and a Stage holds Activities. That is the whole
 * shape. The Activities themselves are registered elsewhere — a Lifecycle
 * names them, it does not define them, so the same Activity participates in
 * as many Lifecycles as a team likes without being duplicated.
 *
 * Stages run in the order they are declared, and a Stage declares how its own
 * Activities run:
 *
 *     serial      one after another, in the order listed — the default
 *     concurrent  all at once, because they do not depend on each other
 *
 * The default matters more than the feature. A file that never mentions
 * `strategy` behaves exactly as it did when strategy did not exist, so
 * adopting concurrency is something a team opts into one Stage at a time
 * rather than something that happens to them on upgrade.
 *
 * `serial` also keeps Stage counts low, which is the reason it exists at all.
 * Without it, grouping would be the only way to say "independent", so every
 * dependent pair would need its own Stage and a Lifecycle would be a list of
 * singletons. A serial Stage is a sequence; a concurrent Stage is a claim.
 *
 * There is no `depends_on`. A Stage depends on the Stage before it, and
 * nothing else. That forecloses exactly one shape — parallel branches of
 * unequal length, a one-Activity branch running alongside a two-Activity
 * branch — which no Lifecycle has needed. Re-introducing the key later stays
 * compatible with every file written in the meantime, because "omitted means
 * the previous Stage" would remain true of all of them.
 */

import { z } from 'zod'
import { isImportName, isTerminalName } from './activity'

export const STAGE_STRATEGIES = ['serial', 'concurrent'] as const
export type TStageStrategy = (typeof STAGE_STRATEGIES)[number]

export const stageSchema = z.object({
  name: z.string(),
  /**
   * How this Stage's Activities run against each other.
   *
   * Unknown values are refused rather than coerced. A typo that silently fell
   * back to `serial` would be a Stage a team believes is concurrent and is
   * not, which is the failure that never announces itself.
   */
  strategy: z.enum(STAGE_STRATEGIES).default('serial'),
  /** Activity names. In a serial Stage this is also the order they run in. */
  activities: z.array(z.string()).default([]),
})
export type TStage = Readonly<z.infer<typeof stageSchema>>

export const lifecycleConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  stages: z.array(stageSchema).default([]),
})
export type TLifecycleConfig = Readonly<z.infer<typeof lifecycleConfigSchema>>

/** What is wrong with a Lifecycle, in the words a developer needs to fix it. */
export type TLifecycleFault = Readonly<{
  lifecycle: string
  message: string
}>

export const writtenStageSchema = z.strictObject({
  name: z.string().min(1),
  serial: z.array(z.string().min(1)).min(1).optional(),
  concurrent: z.array(z.string().min(1)).min(1).optional(),
})
export type TWrittenStage = Readonly<z.infer<typeof writtenStageSchema>>

export const writtenStageFaults = (
  lifecycle: string,
  stages: unknown,
): readonly TLifecycleFault[] => {
  const fault = (message: string): TLifecycleFault => ({ lifecycle, message })
  if (!Array.isArray(stages))
    return [fault('stages must be an array of stage tables')]
  return stages.flatMap((value: unknown, i: number) => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(value)
    const stage = parsed.success ? parsed.data : {}
    const named = typeof stage.name === 'string' && stage.name.length > 0
    const label = named ? `stage '${stage.name}'` : `stage at position ${i}`
    const serial = Object.hasOwn(stage, 'serial')
    const concurrent = Object.hasOwn(stage, 'concurrent')
    const key = serial ? 'serial' : 'concurrent'
    return [
      ...(named ? [] : [fault(`${label} has no name`)]),
      ...(serial === concurrent
        ? [
            fault(
              `${label} names ${serial ? 'both' : 'neither'} serial ${serial ? 'and' : 'nor'} concurrent; a stage names exactly one`,
            ),
          ]
        : z.array(z.string().min(1)).min(1).safeParse(stage[key]).success
          ? []
          : [fault(`${label} lists no Activities under ${key}`)]),
      ...Object.keys(stage)
        .filter((field) => !['name', 'serial', 'concurrent'].includes(field))
        .map((field) =>
          fault(
            `${label} has the key '${field}'; a stage holds name and one of serial or concurrent`,
          ),
        ),
    ]
  })
}

export const stageFromWritten = (stage: TWrittenStage): TStage => ({
  name: stage.name,
  strategy: stage.serial === undefined ? 'concurrent' : 'serial',
  activities: stage.serial ?? stage.concurrent ?? [],
})

/**
 * Two Stages with one name.
 *
 * Harmless while Stages are only a grouping, and not harmless once a Stage is
 * a thing a trace records and `--approve-after stage:<name>` addresses. A
 * name that matches two Stages makes a gate ambiguous, so it is refused here
 * rather than resolved by a rule nobody would guess.
 */
const duplicateStages = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] => {
  const seen = lifecycle.stages.map((stage) => stage.name)

  return [...new Set(seen.filter((name, at) => seen.indexOf(name) !== at))].map(
    (name) => ({
      lifecycle: lifecycle.name,
      message:
        `two stages are named '${name}'; a gate naming a stage could not ` +
        'say which one it meant',
    }),
  )
}

/**
 * An Activity named twice in one Stage.
 *
 * In a serial Stage that is a repeat somebody probably did not mean. In a
 * concurrent Stage it is the same Activity racing itself, in one working
 * tree, writing the same paths.
 */
const repeatedActivities = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] =>
  lifecycle.stages.flatMap((stage) => {
    const seen = stage.activities

    return [
      ...new Set(seen.filter((name, at) => seen.indexOf(name) !== at)),
    ].map((name) => ({
      lifecycle: lifecycle.name,
      message: `stage '${stage.name}' names activity '${name}' twice`,
    }))
  })

/**
 * A terminal Activity, named anywhere except the last entry of the last
 * Stage — or named in a concurrent Stage at all.
 *
 * It is wired to execute after the whole chain has settled, outside the fold
 * — so the only position that does not lie to a reader of the Lifecycle is
 * the position it actually runs in.
 */
export const misplacedTerminal = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] =>
  lifecycle.stages.flatMap((stage, stageAt) =>
    stage.activities.flatMap((name, activityAt) => {
      if (!isTerminalName(name)) {
        return []
      }
      const lastStage = stageAt === lifecycle.stages.length - 1
      const lastActivity = activityAt === stage.activities.length - 1
      if (stage.strategy === 'concurrent') {
        return [
          {
            lifecycle: lifecycle.name,
            message:
              `'${name}' is a terminal Activity and cannot run in a ` +
              `concurrent stage ('${stage.name}') — it does not run alongside ` +
              'anything. It must be the last entry of the last stage.',
          },
        ]
      }
      if (lastStage && lastActivity) {
        return []
      }
      return [
        {
          lifecycle: lifecycle.name,
          message:
            `'${name}' is a terminal Activity and is named in stage ` +
            `'${stage.name}'${lastActivity ? '' : ` (not its last entry)`} — ` +
            'it may only be the last entry of the last stage, because that is ' +
            'the position it executes in.',
        },
      ]
    }),
  )

export const misplacedImport = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] =>
  lifecycle.stages.flatMap((stage, stageAt) =>
    stage.activities.flatMap((name, activityAt) => {
      if (!isImportName(name)) return []
      if (stageAt === 0 && stage.strategy === 'concurrent') {
        return [
          {
            lifecycle: lifecycle.name,
            message: `'import' cannot run in a concurrent stage ('${stage.name}') — it runs before any Activity does. It must be the first entry of a serial first stage.`,
          },
        ]
      }
      if (stageAt === 0 && activityAt === 0) return []
      return [
        {
          lifecycle: lifecycle.name,
          message: `'import' is the engine's import step and is named in stage '${stage.name}' — it may only be the first entry of the first stage, because it runs before any Activity does.`,
        },
      ]
    }),
  )

export const importIn = (stages: readonly TStage[]): boolean =>
  stages.some((stage) => stage.activities.some(isImportName))

export const withoutImport = (stages: readonly TStage[]): readonly TStage[] =>
  stages
    .map((stage) => ({
      ...stage,
      activities: stage.activities.filter((name) => !isImportName(name)),
    }))
    .filter((stage) => stage.activities.length > 0)

/** Every structural fault in a Lifecycle, in the order worth fixing them. */
export const lifecycleFaults = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] => [
  ...duplicateStages(lifecycle),
  ...repeatedActivities(lifecycle),
  ...misplacedTerminal(lifecycle),
  ...misplacedImport(lifecycle),
]

/**
 * The Stages a Lifecycle runs, in order.
 *
 * Declaration order *is* the order, so this is the identity — and it is still
 * worth naming. Callers ask for the execution plan rather than reaching into
 * `.stages`, which is where the answer would have to change if branching ever
 * arrives.
 */
export const stagePlan = (lifecycle: TLifecycleConfig): readonly TStage[] =>
  lifecycle.stages

/**
 * The Activities a Lifecycle runs, flattened.
 *
 * This discards the Stage boundary and the strategy with it, so it answers
 * "which Activities" and never "in what arrangement". It is what the menu
 * shows a person and what `--activities` expands to; the engine takes
 * `stagePlan()` instead, because flattening is the thing it must stop doing.
 */
export const activityOrder = (lifecycle: TLifecycleConfig): readonly string[] =>
  lifecycle.stages.flatMap((stage) => stage.activities)

/** The terminal Activity a Lifecycle names, if any — there is at most one legal position. */
export const terminalIn = (stages: readonly TStage[]): string | undefined =>
  stages.flatMap((stage) => stage.activities).find(isTerminalName)

/** The Stages with any terminal Activity removed, dropping a Stage left empty. */
export const withoutTerminal = (stages: readonly TStage[]): readonly TStage[] =>
  stages
    .map((stage) => ({
      ...stage,
      activities: stage.activities.filter((name) => !isTerminalName(name)),
    }))
    .filter((stage) => stage.activities.length > 0)

/** The Stage an Activity belongs to, or nothing when it is in none of them. */
export const stageOf = (
  lifecycle: TLifecycleConfig,
  activity: string,
): TStage | undefined =>
  lifecycle.stages.find((stage) => stage.activities.includes(activity))

/** Look a Lifecycle up by name. Absent means the file does not declare it. */
export const lifecycleNamed = (
  lifecycles: readonly TLifecycleConfig[],
  name: string,
): TLifecycleConfig | undefined => lifecycles.find((one) => one.name === name)
