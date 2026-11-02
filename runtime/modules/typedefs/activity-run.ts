/**
 * ActivityRun types for the pi-crust workflow system.
 *
 * RULE (four-param rule): any function that takes more than 4 parameters takes
 * ONE of these objects instead. TAgentCall and TActivityRunParams are the pattern.
 */

import { z } from 'zod'

export const ACTIVITY_RUN_KINDS = ['engineer', 'agent', 'code'] as const
/**
 * `waiting` is not a kind of failure.
 *
 * A run stopped at a human gate is neither successful, nor failed, nor
 * running — it is waiting for guidance, and reporting it as failed teaches
 * people to ignore red.
 */
export const ACTIVITY_RUN_STATUSES = [
  'queued',
  'running',
  'success',
  'fail',
  'waiting',
  /*
   * Was successful; has been replaced by a later run of the same activity.
   *
   * Not 'fail' — the activity did its job and the record of what it decided is
   * still worth reading. Resume keys off `success`, so this is also what
   * makes a steered activity run again instead of being skipped.
   */
  'superseded',
  /*
   * Never started, because the run stopped before reaching it.
   *
   * A run that stops at a gate used to leave everything downstream with no
   * row at all, which reads identically to "this lifecycle does not have
   * that activity". The difference matters to anyone asking why a chain
   * produced nothing: blocked says the work is still owed.
   */
  'blocked',
  /*
   * Was going to run, and will not, because the run is ending.
   *
   * Distinct from `blocked`, which is waiting on a person and will resume,
   * and from `fail`, which is something that ran and did not work. An
   * activity downstream of a failure is neither.
   */
  'cancelled',
] as const

export type TActivityRunKind = (typeof ACTIVITY_RUN_KINDS)[number]
export type TActivityRunStatus = (typeof ACTIVITY_RUN_STATUSES)[number]

export const activityRunParamsSchema = z.object({
  /** short id, unique within the run: "plan", "build" */
  name: z.string(),
  /** which lane the block renders in */
  kind: z.enum(ACTIVITY_RUN_KINDS),
  /** the engineer's name, "git", or an agent name from the config */
  owner: z.string(),
  /** REQUIRED: what this activityRun does and why — see activityRunParams below */
  description: z.string(),
})

/*
 * There is no `retries` here any more.
 *
 * It was a gate-failure budget spent INSIDE one Activity Run, which is why
 * a cap counting Activity Runs would have missed gate failures entirely.
 * A re-execution is an Activity Run of its own now, budgeted by the
 * Activity's `attempts`, so this layer has nothing left to count.
 *
 * The column went with it. A database written by an older pi-crust keeps
 * its `retries` and `attempt` columns — `CREATE TABLE IF NOT EXISTS` never
 * revisits a table, and `MIGRATIONS` is additive by construction — and both
 * are nullable, so the inserts that no longer name them still work. New
 * databases simply do not have them.
 */

/** Everything runActivityRun() needs. Passed as one object, never loose params. */
export type TActivityRunParams = Readonly<
  z.infer<typeof activityRunParamsSchema>
>

const collapseWhitespace = (text: string): string =>
  text.split(/\s+/).filter(Boolean).join(' ')

/**
 * Build the params for an activity run. A description that was not earned is rejected.
 *
 * A activityRun name identifies; a description explains. Both are required. The
 * description is the only sentence the trace, the console, and the activityRun block
 * in the UI ever show about intent — everything else is ids, statuses, and
 * timings. `commit_plan: "Commit the plan"` tells a reader nothing they could
 * not already see, so an echo is rejected the same way a blank one is. This
 * throws at construction on purpose: it fires before the activityRun opens, not after
 * a run is already in the trace.
 */
export const activityRunParams = (
  params: Readonly<z.input<typeof activityRunParamsSchema>>,
): TActivityRunParams => {
  const parsed = activityRunParamsSchema.parse(params)
  const description = collapseWhitespace(parsed.description)
  if (description.length === 0) {
    throw new Error(
      `activityRun '${parsed.name}': description is required — one sentence on what ` +
        'this activityRun does and why. It is what the trace and the UI show.',
    )
  }
  if (
    description.replace(/\.+$/, '').toLowerCase() ===
    parsed.name.replace(/_/g, ' ').toLowerCase()
  ) {
    throw new Error(
      `activityRun '${parsed.name}': description '${description}' only restates the ` +
        'activityRun name — say what it does and why instead.',
    )
  }
  return { ...parsed, description }
}

/** The persisted activityRun record — TActivityRunParams plus lifecycle. */
export type TActivityRun = Readonly<{
  activity_run_id: string
  run_id: string
  seq: number
  params: TActivityRunParams
  /** success must be earned */
  status: TActivityRunStatus
  error: string | undefined
  started_at: string | undefined
  ended_at: string | undefined
}>
