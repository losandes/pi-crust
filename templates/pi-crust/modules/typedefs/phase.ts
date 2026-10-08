/**
 * Phase types for the pi-crust workflow system.
 *
 * RULE (four-param rule): any function that takes more than 4 parameters takes
 * ONE of these objects instead. TAgentCall and TPhaseParams are the pattern.
 */

import { z } from 'zod'

export const PHASE_KINDS = ['engineer', 'agent', 'code'] as const
/**
 * `waiting` is not a kind of failure.
 *
 * A run stopped at a human gate is neither successful, nor failed, nor
 * running — it is waiting for guidance, and reporting it as failed teaches
 * people to ignore red.
 */
export const PHASE_STATUSES = [
  'queued',
  'running',
  'success',
  'fail',
  'waiting',
  /*
   * Was successful; has been replaced by a later run of the same step.
   *
   * Not 'fail' — the step did its job and the record of what it decided is
   * still worth reading. Resume keys off `success`, so this is also what
   * makes a steered step run again instead of being skipped.
   */
  'superseded',
] as const

export type TPhaseKind = (typeof PHASE_KINDS)[number]
export type TPhaseStatus = (typeof PHASE_STATUSES)[number]

export const phaseParamsSchema = z.object({
  /** short id, unique within the run: "plan", "build" */
  name: z.string(),
  /** which lane the block renders in */
  kind: z.enum(PHASE_KINDS),
  /** the engineer's name, "git", or an agent name from the config */
  owner: z.string(),
  /** REQUIRED: what this phase does and why — see phaseParams below */
  description: z.string(),
  /** agent phases: gate-failure retries via continue */
  retries: z.number().int().default(0),
})

/** Everything runPhase() needs. Passed as one object, never loose params. */
export type TPhaseParams = Readonly<z.infer<typeof phaseParamsSchema>>

const collapseWhitespace = (text: string): string =>
  text.split(/\s+/).filter(Boolean).join(' ')

/**
 * Build the params for a phase. A description that was not earned is rejected.
 *
 * A phase name identifies; a description explains. Both are required. The
 * description is the only sentence the trace, the console, and the phase block
 * in the UI ever show about intent — everything else is ids, statuses, and
 * timings. `commit_plan: "Commit the plan"` tells a reader nothing they could
 * not already see, so an echo is rejected the same way a blank one is. This
 * throws at construction on purpose: it fires before the phase opens, not after
 * a run is already in the trace.
 */
export const phaseParams = (
  params: Readonly<z.input<typeof phaseParamsSchema>>,
): TPhaseParams => {
  const parsed = phaseParamsSchema.parse(params)
  const description = collapseWhitespace(parsed.description)
  if (description.length === 0) {
    throw new Error(
      `phase '${parsed.name}': description is required — one sentence on what ` +
        'this phase does and why. It is what the trace and the UI show.',
    )
  }
  if (
    description.replace(/\.+$/, '').toLowerCase() ===
    parsed.name.replace(/_/g, ' ').toLowerCase()
  ) {
    throw new Error(
      `phase '${parsed.name}': description '${description}' only restates the ` +
        'phase name — say what it does and why instead.',
    )
  }
  return { ...parsed, description }
}

/** The persisted phase record — TPhaseParams plus lifecycle. */
export type TPhase = Readonly<{
  phase_id: string
  run_id: string
  seq: number
  params: TPhaseParams
  /** success must be earned */
  status: TPhaseStatus
  attempt: number
  error: string | undefined
  started_at: string | undefined
  ended_at: string | undefined
}>
