/**
 * A Work Unit: what the engine runs in one go, and gates after.
 *
 * A Lifecycle's Stages become Units before execution, and the mapping is
 * where the two strategies differ:
 *
 *     serial      one Unit per Activity — the chain pauses between them
 *     concurrent  one Unit for the whole Stage — they start together
 *
 * That is the entire implementation of "an Activity gate in a concurrent
 * Stage is lifted to the Stage boundary". The gate always fires after a Unit;
 * making a concurrent Stage a single Unit is what stops an Activity that
 * raised a question from killing its in-flight siblings, and making a serial
 * Stage several Units is what keeps `--approve-after plan` pausing the moment
 * `plan` finishes rather than at the end of the Stage it sits in.
 *
 * No special case in the driver decides this. The shape of the Unit list
 * already says it.
 */

import type { TStageStrategy } from './lifecycle'
import type { TActivity } from './runnable-activity'

export type TUnit = Readonly<{
  /** the Stage these Activities came from, for gates and for the trace */
  stage: string
  strategy: TStageStrategy
  /** one for a serial Activity; the whole Stage when it is concurrent */
  activities: readonly TActivity[]
  /** whether this is the last Unit of its Stage, which is where a stage gate sits */
  endsStage: boolean
}>

/** The prefix that addresses a Stage rather than an Activity in a gate list. */
export const STAGE_GATE_PREFIX = 'stage:'

/**
 * Whether a gate list asks to stop after this Stage.
 *
 * `--approve-after plan,stage:accept` holds both kinds. Activities and Stages
 * share a namespace otherwise, and a bare name that matched either would make
 * `accept` ambiguous the first time somebody named a Stage after the Activity
 * it contains.
 */
export const wantsStageGate = (
  approveAfter: readonly string[],
  stage: string,
): boolean => approveAfter.includes(`${STAGE_GATE_PREFIX}${stage}`)

/** The Activity names in a gate list, with the Stage entries removed. */
export const activityGates = (
  approveAfter: readonly string[],
): readonly string[] =>
  approveAfter.filter((one) => !one.startsWith(STAGE_GATE_PREFIX))
