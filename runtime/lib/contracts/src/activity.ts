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
 * records a sequence, so nothing else can drift out of activity with the
 * Activities that actually exist.
 */

import { z } from 'zod'
import { envelopeNamed, reviewOutput } from './envelope'

/**
 * The primitives an Activity and the roster share.
 *
 * They live here rather than in `config.ts` because the roster is now
 * assembled FROM Activities: a config that imported this file while this
 * file imported it back would be a cycle, and the shared half is the small
 * half. `config.ts` re-exports all three, so every existing importer is
 * unaffected.
 */
export const CODING_AGENTS = ['pi', 'claude_code'] as const
export type TCodingAgent = (typeof CODING_AGENTS)[number]

export const DEFAULT_MODEL = 'google/gemini-3.6-flash'

export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export const promptsSchema = z.object({
  /** path to system.md */
  system: z.string(),
  /** path to user.md */
  user: z.string(),
  /** path to the revise-round prompt; absent means "resolve it beside `user`" */
  revise: z.string().optional(),
})
export type TPrompts = Readonly<z.infer<typeof promptsSchema>>

export const DEFAULT_ACTIVITIES_PATH = '.pi-crust/config/crust.activities.yaml'

/**
 * How many Activity Runs of ONE instance a Workflow Run may spend.
 *
 * Two, including the first. Every autonomous re-execution — a gate failure,
 * a revision, a regression — comes out of the same budget, because the
 * failure modes are correlated: one bad input expresses itself as all three
 * in turn, and three separate budgets let it burn three times before a
 * person is asked.
 *
 * An Activity whose re-execution is expensive should declare `attempts: 1`
 * rather than inherit this.
 */
export const DEFAULT_ATTEMPTS = 2

/**
 * The Planners: they decide what happens and perform none of it.
 *
 * A CLOSED set, in code. Configuration tunes a Planner's model, tools,
 * writes and prompts; it cannot add one or take one away, because a Planner
 * is wired into the engine rather than named by a Lifecycle. The Composer is
 * the third and has no entry at all: it has no agent.
 */
export const PLANNER_NAMES = ['operator', 'triage'] as const
export type TPlannerName = (typeof PLANNER_NAMES)[number]

export const isPlannerName = (name: string): name is TPlannerName =>
  (PLANNER_NAMES as readonly string[]).includes(name)

export const activityConfigSchema = z.object({
  name: z.string(),
  coding_agent: z.enum(CODING_AGENTS).default('pi'),
  model: z.string().default(DEFAULT_MODEL),
  /** off | minimal | low | medium | high | xhigh | max */
  thinking: z.string().default('medium'),
  /** hex swatch for this Activity's lane in the UI */
  color: z.string().default(''),
  purpose: z.string().default(''),
  prompts: promptsSchema,
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
  /*
   * Other names this Activity answers to, where a human types one.
   *
   * Resolved where a human names an Activity — the `--activities` chain,
   * `--model` overrides and a Lifecycle's `stages[].activities` — and nowhere
   * after them: an activity-run row, a resume and the attempt budget all key
   * on the Activity's name. Two names for one Activity inside one trace would
   * split its history and attempt budget.
   *
   * A preference rather than a permission, and on the entry rather than in a
   * list elsewhere, so a personal shorthand can live in the gitignored local
   * layer without the team inheriting it. There is no prefix matching: a name
   * whose meaning changes the next time an Activity is added would warn
   * nobody.
   */
  aliases: z.array(z.string()).default([]),
  // What this Activity may MODIFY in the repo, enforced in code after every
  // call (see domains/policy/src/use-cases/enforce-permissions.ts). `tools`
  // cannot express this: `bash` runs anything and `write` reaches any path,
  // so an Activity's capability list is a statement of intent that nothing
  // checks.
  //   undefined -> unrestricted, except the roster-wide `protected_files`
  //   []        -> read-only: may modify nothing tracked
  //   [...]     -> only these. A trailing "/" means a directory prefix; a "*"
  //                makes it a glob; anything else is an exact path.
  writes: z.array(z.string()).optional(),

  // ── the work half ────────────────────────────────────────────────────────
  // An Activity entry carries what the performer IS and what the work NEEDS,
  // because they are the same thing: a Lifecycle names `plan`, and `plan` is
  // this entry. Everything below names something the package publishes by
  // name, and a name nothing publishes is refused at load.

  /** the envelope spec this Activity answers with, from `ENVELOPE_CATALOGUE` */
  output: z.string().default('genericOutput'),
  /**
   * Does this Activity's output replace what came before it, or comment on it?
   *
   * Omitted is the ordinary case: an Activity that reports a verdict annotates,
   * and everything else supersedes. Declared only where the default is wrong.
   */
  succession: z.enum(['supersedes', 'annotates']).optional(),
  /**
   * What this Activity is handed as its `previous` envelope, from
   * `INPUT_CATALOGUE`.
   *
   *   upstream  the most recent superseding work (the default)
   *   changes   the diff this run has made since its own baseline
   *
   * `changes` is what the documenter needs: it writes up a change rather
   * than answering the Activity before it, and a run that commits as it goes
   * has already moved `main` by the time it documents.
   */
  input: z.string().default('upstream'),
  /** Activity Runs of this instance one Workflow Run may spend, first included */
  attempts: z.number().int().min(1).default(DEFAULT_ATTEMPTS),
  /**
   * Commit this Activity's own change once every gate on it has passed.
   *
   * Granularity follows the chain: several writing Activities produce
   * several commits, each in the words of the envelope that wrote it. An
   * Activity that does not declare this is not committed by anybody — not by
   * pi-crust, and not by the agent performing it, which `enforce-permissions`
   * checks rather than asks for.
   */
  commit: z.boolean().default(false),
})
export type TActivityConfig = Readonly<z.infer<typeof activityConfigSchema>>

/**
 * A Planner's entry: the agent half only.
 *
 * No `output`, `succession`, `input`, `attempts` or `commit`, because
 * a Planner's work configuration is the engine's and not a team's. What a
 * team may change is who answers and how: model, thinking, tools, writes, prompts.
 */
export const plannerConfigSchema = activityConfigSchema.omit({
  output: true,
  succession: true,
  input: true,
  attempts: true,
  commit: true,
  aliases: true,
})
export type TPlannerConfig = Readonly<z.infer<typeof plannerConfigSchema>>

/** The engine's import step: named first in a Lifecycle, run before the fold, never an Activity. */
export const IMPORT_NAME = 'import'
export const isImportName = (name: string): boolean => name === IMPORT_NAME

/**
 * The terminal Activities: they run after the chain has settled, and act on
 * the outside world with the run's actual verdict in hand.
 *
 * A CLOSED set, in code, exactly as the Planners are. Configuration tunes who
 * answers and where it delivers; it cannot add one, because a terminal
 * Activity is wired into the engine. The forge is in the name deliberately: a
 * GitLab merge request is a different Activity, not a flag on this one.
 */
export const TERMINAL_NAMES = ['gh-pull-request'] as const
export type TTerminalName = (typeof TERMINAL_NAMES)[number]

export const isTerminalName = (name: string): name is TTerminalName =>
  (TERMINAL_NAMES as readonly string[]).includes(name)

/** Where the deterministic half delivers. It belongs to the entry, not to the run. */
export const deliverySchema = z.object({
  remote: z.string().default('origin'),
  base: z.string().optional(),
  draft: z.boolean().default(false),
})
export type TDelivery = Readonly<z.infer<typeof deliverySchema>>

/**
 * A terminal entry's config: a Planner's shape, plus where it delivers.
 *
 * No `output`, `succession`, `input`, `attempts` or `commit` — same
 * reasoning as `plannerConfigSchema`: a terminal Activity's work configuration
 * is the engine's, not a team's.
 */
export const terminalConfigSchema = plannerConfigSchema.extend({
  delivery: deliverySchema.default({
    remote: 'origin',
    draft: false,
  }),
})
export type TTerminalConfig = Readonly<z.infer<typeof terminalConfigSchema>>

/**
 * Every Terminal Activity is configured, and nothing else is — in
 * `plannerFaults`'s voice, for the same reason.
 */
export const terminalFaults = (
  terminal: readonly Readonly<{ name: string }>[],
): readonly string[] => {
  const named = terminal.map((one) => one.name)
  const missing = TERMINAL_NAMES.filter((one) => !named.includes(one))
  const unknown = named.filter((one) => !isTerminalName(one))

  return [
    ...missing.map(
      (one) =>
        `terminal Activity '${one}' has no entry under terminal: — the ` +
        `terminal Activities are ${TERMINAL_NAMES.join(', ')}, and every ` +
        'one of them must be configured',
    ),
    ...unknown.map(
      (one) =>
        `'${one}' is under terminal: and is not a terminal Activity — the ` +
        `terminal Activities are ${TERMINAL_NAMES.join(', ')}, and ` +
        'configuration cannot add one. Add it under activities: instead.',
    ),
  ]
}

export const activitiesFileSchema = z.object({
  activities: z.array(activityConfigSchema).default([]),
  planners: z.array(plannerConfigSchema).default([]),
  terminal: z.array(terminalConfigSchema).default([]),
})
export type TActivitiesFile = Readonly<z.infer<typeof activitiesFileSchema>>

/**
 * Every Planner is configured, and nothing else is.
 *
 * Refused at load rather than discovered when a run reaches for one: an
 * engine Planner with no entry has no prompts, and an entry naming something
 * that is not a Planner is a team believing it can add one.
 */
export const plannerFaults = (
  planners: readonly Readonly<{ name: string }>[],
): readonly string[] => {
  const named = planners.map((one) => one.name)
  const missing = PLANNER_NAMES.filter((one) => !named.includes(one))
  const unknown = named.filter((one) => !isPlannerName(one))

  return [
    ...missing.map(
      (one) =>
        `planner '${one}' has no entry under planners: — the Planners are ` +
        `${PLANNER_NAMES.join(', ')}, and every one of them must be configured`,
    ),
    ...unknown.map(
      (one) =>
        `'${one}' is under planners: and is not a Planner — the Planners are ` +
        `${PLANNER_NAMES.join(', ')}, and configuration cannot add one. ` +
        'Add it under activities: instead.',
    ),
  ]
}

/**
 * A local layer, which is a PATCH and cannot be a complete Activity.
 *
 * Validating it with the schema above would reject every partial override —
 * `- name: builder` with a model and nothing else has no prompts, which a
 * whole Activity must have. So the local file is read as records, merged,
 * and the RESULT is what gets validated. A mistake in a local layer still
 * fails, one activity later, against the merged Activity it produced.
 */
export const activityPatchFileSchema = z.object({
  activities: z.array(z.record(z.string(), z.unknown())).default([]),
  planners: z.array(z.record(z.string(), z.unknown())).default([]),
  terminal: z.array(z.record(z.string(), z.unknown())).default([]),
})

/** Look an Activity up by name. Absent means the registry does not have it. */
export const activityNamed = (
  activities: readonly TActivityConfig[],
  name: string,
): TActivityConfig | undefined => activities.find((one) => one.name === name)

/** Succession comes from the loaded registry, never the envelope's shape. */
export const activitySuccession = (
  activities: readonly TActivityConfig[],
  name: string,
): 'supersedes' | 'annotates' => {
  const activity = activityNamed(activities, name)

  return (
    activity?.succession ??
    (envelopeNamed(activity?.output ?? '') === reviewOutput
      ? 'annotates'
      : 'supersedes')
  )
}

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
  Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(local)])].map((key) => [
      key,
      Object.hasOwn(local, key)
        ? isPlainObject(local[key]) && isPlainObject(base[key])
          ? mergeInto(base[key], local[key])
          : local[key]
        : base[key],
    ]),
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
