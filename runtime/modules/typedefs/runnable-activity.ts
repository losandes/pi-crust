/**
 * Activities: one named, independently runnable unit of a workflow.
 *
 * A workflow used to be a hand-written sequence of activity runs. A activity is that same
 * activityRun plus the two things composition needs — the agents it requires (so a
 * chain validates its whole roster before anything spawns) and how it is
 * REPLAYED (so `--resume` can skip it without inventing its result).
 *
 * Every activity is runnable on its own (`just crust run "..." --activities <activity>`), and
 * `compose.ts` runs any ordered subset of them.
 *
 * A activity's NAME is an Activity's name, and Activities are configuration:
 * there is no union of them here any more, and no registry in TypeScript for
 * a name to be checked against. "Is this a real Activity" is answered at
 * load, by the loader, against `crust.activities.yaml` / which is the price
 * of a team being able to add one.
 */

import type { TEnvelopeBase } from './envelope'
import type { TGate } from './gate'
import type { TActivityRunParams } from './activity-run'
import type { TActivityRunHandle, TRun } from './run'

/** What a activity is handed. Folded forward by `runActivities`, never mutated. */
/** One upstream result, with the Activity that produced it. */
export type TUpstream = Readonly<{
  activity: string
  envelope: TEnvelopeBase
}>

export type TActivityContext = Readonly<{
  run: TRun
  prompt: string
  /** the previous activity's envelope — what an agent reads as previous_envelope */
  previous: TEnvelopeBase | undefined
  /**
   * Which activity produced `previous`, and the ONLY reliable way to know what it
   * is. Every envelope schema defaults its distinguishing fields, so a build
   * envelope parses cleanly as a review with `approved: false` — the shape
   * cannot answer "is this a verdict", and a consumer that asks it gets a
   * confident lie. The driver knows; it now says.
   */
  previousStep: string | undefined
  /**
   * Every Activity the preceding Unit produced, with its name.
   *
   * `previous` answers "the envelope before this one", which a concurrent
   * Stage makes into a question with several right answers. This is all of
   * them, in declaration order, and it is what an agent downstream of a
   * concurrent Stage is actually shown — picking one and discarding the rest
   * would silently drop the finding the second Activity existed to produce.
   *
   * One entry in the ordinary case, so nothing serial has to care.
   */
  upstream: readonly TUpstream[]
  /**
   * The other Activities running at the same time as this one, by name.
   *
   * Empty unless a concurrent Stage is in flight. It exists so permission
   * enforcement can tell this agent's writes from its siblings' by the paths
   * they declared, rather than by the interval they ran in — which is the
   * only question an interval cannot answer once two things share it.
   */
  cohort: readonly string[]
  /** HEAD as it was before this run committed anything, for `document` */
  baseline: string
  /**
   * What each activity decided, in order — the record, not a running total.
   *
   * It was two booleans: `accepted`, and `priorAccepted` for "the same thing
   * excluding the most recent activity", which the revise loop needs because it
   * re-asks the question the last review already answered. Two fields with an
   * invariant between them is one more than the data requires, and the
   * derived one was subtly wrong: it excluded the LAST activity, so a chain
   * ending `review, code-review` kept the earlier review's rejection ANDed in
   * and could never come back green however well the loop went.
   *
   * Keeping the outcomes lets a caller exclude exactly what it is re-asking.
   */
  outcomes: readonly TActivityOutcome[]
  /**
   * What a gate said about this Activity's LAST attempt, fed back to it.
   *
   * Empty on a first attempt. A gate failure re-runs the Activity rather
   * than correcting it in place, so the violations have to travel with the
   * context / otherwise the second attempt is the first attempt again, at
   * the same price and with the same result.
   */
  feedback: readonly string[]
}>

/** One activity's verdict on its own criterion. */
export type TActivityOutcome = Readonly<{
  activity: string
  accepted: boolean
}>

/** Every activity held. An empty run is accepted; nothing has failed. */
export const allAccepted = (outcomes: readonly TActivityOutcome[]): boolean =>
  outcomes.every((outcome) => outcome.accepted)

/**
 * Every activity held EXCEPT the named ones.
 *
 * What the revise loop needs: the verdicts it is about to re-ask are set
 * aside, and everything else — a failed `checks` gate, say — stays decisive.
 */
export const acceptedExcluding = (
  outcomes: readonly TActivityOutcome[],
  excluded: readonly string[],
): boolean =>
  outcomes.every(
    (outcome) => excluded.includes(outcome.activity) || outcome.accepted,
  )

export type TActivityResult = Readonly<{
  previous: TEnvelopeBase | undefined
  /**
   * Did THIS activity's own criterion hold?
   *
   * Not the same question as "did the activityRun run". A review that ruled
   * against the work did its job: the Activity Run succeeds and `accepted`
   * is false, which is what `finish(accepted:)` settles.
   */
  accepted: boolean
}>

export type TActivity = Readonly<{
  /** the Activity, as a Lifecycle names it */
  name: string
  /** this occurrence of it: `build`, `build_2` — what a budget is kept per */
  instance: string
  params: TActivityRunParams
  /** agent names this activity needs, checked before anything spawns */
  requires: readonly string[]
  /**
   * What this Activity's envelope must survive, as the registry declared it.
   *
   * Carried on the activity rather than applied inside the agent call, because
   * the driver is what decides WHEN a gate is judged: a gate that reads the
   * working tree waits for the Stage boundary, where a pure one does not.
   */
  gates: readonly TGate[]
  /** Activity Runs of this instance the run may spend, the first included */
  attempts: number
  /** commit this Activity's own change once its gates have passed */
  commit: boolean
  execute: (ctx: TActivityContext, handle: TActivityRunHandle) => Promise<TActivityResult>
  replay: (ctx: TActivityContext) => Promise<TActivityResult>
}>

/** Per-call-site knobs. `instance` disambiguates a repeated activity. */
export type TActivityOptions = Readonly<{
  /** the ref or range a judging Activity rules on; '' is the working tree */
  base: string
  /** 1 for the first occurrence; 2+ suffixes the activityRun name (`build_2`) */
  instance: number
  /**
   * Whether committing is permitted at all in this run.
   *
   * `--commit false` subtracts; there is no `--commit true`. A flag that
   * granted a permission the registry withheld would make a run behave in a
   * way nobody reading the registry could predict.
   */
  committing: boolean
}>

export const DEFAULT_ACTIVITY_OPTIONS: TActivityOptions = {
  // '' and not 'main': a activity must be able to tell "no --base was given" from
  // "--base main was given", and only `document` falls back to main.
  base: '',
  instance: 1,
  committing: true,
}

/** `build`, `build_2`, `build_3` … so a composed chain can repeat a activity. */
export const activityRunName = (name: string, instance: number): string =>
  instance <= 1 ? name : `${name}_${instance}`
