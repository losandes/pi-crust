/**
 * An Activity: a discrete unit of work, and everything the runner needs to
 * perform it.
 *
 * This is the concept the implementation has until now called an agent. The
 * vocabulary comes from the orchestration model, where an Activity performs
 * work and a Stage groups Activities inside a Lifecycle. There is no Stage
 * here, deliberately: a Stage is structure within a Lifecycle definition, and
 * an Activity does not know what runs around it.
 *
 * Activities are registered in `crust.activities.yaml`, which lists every one
 * the core skill offers rather than only a team's additions. Listing them all
 * is what lets a team remove one: deleting an entry removes the capability,
 * where an additions-only file could only ever add to a fixed set.
 *
 * The order of the array is the order interactive lists display. Nothing else
 * records a sequence, so nothing else can drift out of step with the
 * Activities that actually exist.
 */

import { z } from 'zod'
import { CODING_AGENTS, DEFAULT_MODEL, promptEngineeringSchema } from './config'

export const DEFAULT_ACTIVITIES_PATH = '.pi-crust/config/crust.activities.yaml'

export const activityConfigSchema = z.object({
  name: z.string(),
  coding_agent: z.enum(CODING_AGENTS).default('pi'),
  model: z.string().default(DEFAULT_MODEL),
  /** off | minimal | low | medium | high | xhigh | max */
  thinking: z.string().default('medium'),
  /** hex swatch for this Activity's lane in the UI */
  color: z.string().default(''),
  purpose: z.string().default(''),
  prompt_engineering: promptEngineeringSchema,
  harness_engineering: z.array(z.string()).default([]),
  /** allowlist; undefined = all tools usable */
  tools: z.array(z.string()).optional(),
  /*
   * Kept out of interactive menus, for a team that drives this with
   * Lifecycles or a Planner and does not want to scroll past Activities
   * nobody picks by hand.
   *
   * Hiding is a preference, not a permission: a hidden Activity still runs
   * by name, inside a Lifecycle, and under a Planner. It is a property of
   * the Activity rather than a list elsewhere so that adding an Activity
   * offers it with no second edit, and so a local layer can hide one
   * without changing what the team ships.
   */
  hidden: z.boolean().default(false),
  // What this Activity may MODIFY in the repo, enforced in code after every
  // call (see modules/use-cases/enforce-permissions.ts). `tools` cannot
  // express this: `bash` runs anything and `write` reaches any path, so an
  // Activity's capability list is a statement of intent that nothing checks.
  //   undefined -> unrestricted, except the roster-wide `protected_files`
  //   []        -> read-only: may modify nothing tracked
  //   [...]     -> only these. A trailing "/" means a directory prefix; a "*"
  //                makes it a glob; anything else is an exact path.
  writes: z.array(z.string()).optional(),
})
export type TActivityConfig = Readonly<z.infer<typeof activityConfigSchema>>

export const activitiesFileSchema = z.object({
  activities: z.array(activityConfigSchema).default([]),
})
export type TActivitiesFile = Readonly<z.infer<typeof activitiesFileSchema>>

/**
 * A local layer, which is a PATCH and cannot be a complete Activity.
 *
 * Validating it with the schema above would reject every partial override —
 * `- name: builder` with a model and nothing else has no prompts, which a
 * whole Activity must have. So the local file is read as records, merged,
 * and the RESULT is what gets validated. A mistake in a local layer still
 * fails, one step later, against the merged Activity it produced.
 */
export const activityPatchFileSchema = z.object({
  activities: z.array(z.record(z.string(), z.unknown())).default([]),
})

/** Look an Activity up by name. Absent means the registry does not have it. */
export const activityNamed = (
  activities: readonly TActivityConfig[],
  name: string,
): TActivityConfig | undefined => activities.find((one) => one.name === name)

/**
 * A developer's private layer, merged over the team's.
 *
 * `crust.activities.yaml` is the repository's answer and is reviewed.
 * `crust.activities.local.yaml` beside it, gitignored, is one person's
 * deviation. It may set any key and may introduce an Activity the team file
 * does not have.
 *
 * There is no restricted subset, deliberately. A restriction here would
 * protect nothing: the developer who writes the local file can equally write
 * the committed one, and runs the result on their own machine against their
 * own checkout. The only real difference between the two files is whether
 * git tracks them.
 *
 * The cost is a Lifecycle that names an Activity only one machine has. That
 * is reported by validation, not prevented here.
 */

type TMergeable = Record<string, unknown>

const isPlainObject = (value: unknown): value is TMergeable =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Per-key, with the local value winning.
 *
 * A nested object merges, so a local layer can replace one prompt without
 * restating the other. An array replaces outright, because the alternatives
 * are worse: concatenating cannot remove a tool, and merging by index
 * silently rewrites a list whose order means nothing.
 */
const mergeInto = (base: TMergeable, local: TMergeable): TMergeable =>
  Object.entries(local).reduce<TMergeable>(
    (merged, [key, value]) => ({
      ...merged,
      [key]:
        isPlainObject(value) && isPlainObject(merged[key])
          ? mergeInto(merged[key], value)
          : value,
    }),
    base,
  )

/**
 * The team's Activities with a developer's layered over them.
 *
 * Declared order is preserved, because it is what interactive lists display:
 * an overridden Activity keeps its place, and one that exists only locally
 * joins the end.
 */
export const mergeActivities = (
  base: readonly TMergeable[],
  local: readonly TMergeable[],
): readonly TMergeable[] => {
  const overrides = new Map(
    local.map((one) => [one.name as string, one] as const),
  )
  const overridden = base.map((one) => {
    const override = overrides.get(one.name as string)

    return override === undefined ? one : mergeInto(one, override)
  })
  const known = new Set(base.map((one) => one.name as string))

  return [
    ...overridden,
    ...local.filter((one) => !known.has(one.name as string)),
  ]
}
