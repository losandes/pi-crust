/**
 * A Lifecycle: the progression of an objective, as configuration.
 *
 * A Lifecycle holds Stages, a Stage holds Activities, and a Stage may depend
 * on Stages that came before it. That is the whole shape. The Activities
 * themselves are registered elsewhere — a Lifecycle names them, it does not
 * define them, so the same Activity participates in as many Lifecycles as a
 * team likes without being duplicated.
 *
 * Dependencies are declared rather than implied by position. Today they are
 * flattened back to a serial order, which is what the current engine
 * executes; declaring them now is what lets the engine stop flattening later
 * without every team rewriting their configuration.
 *
 * A Stage with no `depends_on` depends on nothing and could run first. That
 * is deliberate, not an omission: a Lifecycle whose Stages are genuinely
 * independent should say so.
 */

import { z } from 'zod'

export const DEFAULT_LIFECYCLES_PATH =
  '.pi-crust/config/crust.lifecycles.yaml'

export const stageSchema = z.object({
  name: z.string(),
  /** Activity names, in the order they should run within this Stage. */
  activities: z.array(z.string()).default([]),
  /** Stages that must complete before this one may begin. */
  depends_on: z.array(z.string()).default([]),
})
export type TStage = Readonly<z.infer<typeof stageSchema>>

export const lifecycleConfigSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  stages: z.array(stageSchema).default([]),
})
export type TLifecycleConfig = Readonly<z.infer<typeof lifecycleConfigSchema>>

export const lifecyclesFileSchema = z.object({
  lifecycles: z.array(lifecycleConfigSchema).default([]),
})
export type TLifecyclesFile = Readonly<z.infer<typeof lifecyclesFileSchema>>

/** What is wrong with a Lifecycle, in the words a developer needs to fix it. */
export type TLifecycleFault = Readonly<{
  lifecycle: string
  message: string
}>

const unknownDependencies = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] => {
  const declared = new Set(lifecycle.stages.map((stage) => stage.name))

  return lifecycle.stages.flatMap((stage) =>
    stage.depends_on
      .filter((needed) => !declared.has(needed))
      .map((needed) => ({
        lifecycle: lifecycle.name,
        message:
          `stage '${stage.name}' depends on '${needed}', which this ` +
          'lifecycle does not declare',
      })),
  )
}

/**
 * Stage names in an order that satisfies every dependency, or nothing when
 * the graph cannot be ordered.
 *
 * Kahn's algorithm, with ties broken by declaration order so that a Lifecycle
 * whose Stages are all independent runs in the order it was written. Without
 * that tiebreak the same configuration could order differently between runs,
 * and a trace would stop being comparable with the one before it.
 */
export const stageOrder = (
  lifecycle: TLifecycleConfig,
): readonly string[] | undefined => {
  const names = lifecycle.stages.map((stage) => stage.name)
  const blockers = new Map(
    lifecycle.stages.map((stage) => [
      stage.name,
      new Set(stage.depends_on.filter((needed) => names.includes(needed))),
    ]),
  )

  const settle = (
    done: readonly string[],
  ): readonly string[] | undefined => {
    if (done.length === names.length) {
      return done
    }
    const ready = names.find(
      (name) =>
        !done.includes(name) &&
        [...(blockers.get(name) ?? [])].every((needed) =>
          done.includes(needed),
        ),
    )

    // Nothing is ready and nothing is finished: every remaining Stage is
    // waiting on another, which is a cycle.
    return ready === undefined ? undefined : settle([...done, ready])
  }

  return settle([])
}

/** Every fault in a Lifecycle: unknown dependencies first, then cycles. */
export const lifecycleFaults = (
  lifecycle: TLifecycleConfig,
): readonly TLifecycleFault[] => {
  const unknown = unknownDependencies(lifecycle)
  if (unknown.length > 0) {
    return unknown
  }

  return stageOrder(lifecycle) === undefined
    ? [
        {
          lifecycle: lifecycle.name,
          message:
            'stages depend on each other in a cycle, so no order satisfies ' +
            'them — a lifecycle progresses, it does not loop',
        },
      ]
    : []
}

/**
 * The Activities a Lifecycle runs, in order.
 *
 * Stages are ordered by their dependencies; Activities within a Stage keep
 * the order they were declared in. The result is the flat list the current
 * engine executes, which is why a configured Lifecycle produces the same
 * trace as the file it replaces.
 */
export const activityOrder = (
  lifecycle: TLifecycleConfig,
): readonly string[] => {
  const order = stageOrder(lifecycle)
  if (order === undefined) {
    return []
  }
  const byName = new Map(
    lifecycle.stages.map((stage) => [stage.name, stage] as const),
  )

  return order.flatMap((name) => byName.get(name)?.activities ?? [])
}

/** Look a Lifecycle up by name. Absent means the file does not declare it. */
export const lifecycleNamed = (
  lifecycles: readonly TLifecycleConfig[],
  name: string,
): TLifecycleConfig | undefined =>
  lifecycles.find((one) => one.name === name)
