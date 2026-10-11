/**
 * Steps: one named, independently runnable unit of a workflow.
 *
 * A workflow used to be a hand-written sequence of activity runs. A step is that same
 * activityRun plus the two things composition needs — the agents it requires (so a
 * chain validates its whole roster before anything spawns) and how it is
 * REPLAYED (so `--resume` can skip it without inventing its result).
 *
 * Every step is runnable on its own (`bun .pi-crust/stages/<step>.ts`), and
 * `compose.ts` runs any ordered subset of them.
 */

import type { TEnvelopeBase } from './envelope'
import type { TActivityRunParams } from './activity-run'
import type { TActivityRunHandle, TRun } from './run'

export const STEP_NAMES = [
  'prompt',
  'scout',
  /*
   * The research disciplines. Each establishes what is TRUE in its own
   * subject and decides nothing: they exist because "find out" and "decide"
   * are different jobs, and a stage asked to do both will quietly do the
   * second while appearing to do the first.
   */
  'technical-research',
  'ux-research',
  'domain-research',
  'security-research',
  'data-research',
  /* Turns validated needs into something an engineer can build without
   * inventing UX decisions. Not research: it decides. */
  'ux-design',
  /* Chooses the chain itself, and performs none of it. */
  'operator',
  /*
   * The same choice, handed back instead of executed.
   *
   * Separate from `operator` rather than a flag on it, because what a step
   * DOES is how this system is read: a reader looking at a trace can see
   * that nothing after this one was going to run, without knowing which
   * flags the run was started with.
   */
  'triage',
  'identify',
  'diagnose',
  'conceptualize',
  'plan',
  'design',
  'poc',
  'test',
  'build',
  'verify',
  'review',
  'code-review',
  'revise',
  'commit',
  'document',
] as const

export type TStepName = (typeof STEP_NAMES)[number]

export const isStepName = (name: string): name is TStepName =>
  (STEP_NAMES as readonly string[]).includes(name)

/** What a step is handed. Folded forward by `runSteps`, never mutated. */
/** One upstream result, with the Activity that produced it. */
export type TUpstream = Readonly<{
  step: TStepName
  envelope: TEnvelopeBase
}>

export type TStepContext = Readonly<{
  run: TRun
  prompt: string
  /** the previous step's envelope — what an agent reads as previous_envelope */
  previous: TEnvelopeBase | undefined
  /**
   * Which step produced `previous`, and the ONLY reliable way to know what it
   * is. Every envelope schema defaults its distinguishing fields, so a build
   * envelope parses cleanly as a review with `approved: false` — the shape
   * cannot answer "is this a verdict", and a consumer that asks it gets a
   * confident lie. The driver knows; it now says.
   */
  previousStep: TStepName | undefined
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
   * What each step decided, in order — the record, not a running total.
   *
   * It was two booleans: `accepted`, and `priorAccepted` for "the same thing
   * excluding the most recent step", which the revise loop needs because it
   * re-asks the question the last review already answered. Two fields with an
   * invariant between them is one more than the data requires, and the
   * derived one was subtly wrong: it excluded the LAST step, so a chain
   * ending `review, code-review` kept the earlier review's rejection ANDed in
   * and could never come back green however well the loop went.
   *
   * Keeping the outcomes lets a caller exclude exactly what it is re-asking.
   */
  outcomes: readonly TStepOutcome[]
}>

/** One step's verdict on its own criterion. */
export type TStepOutcome = Readonly<{
  step: TStepName
  accepted: boolean
}>

/** Every step held. An empty run is accepted; nothing has failed. */
export const allAccepted = (outcomes: readonly TStepOutcome[]): boolean =>
  outcomes.every((outcome) => outcome.accepted)

/**
 * Every step held EXCEPT the named ones.
 *
 * What the revise loop needs: the verdicts it is about to re-ask are set
 * aside, and everything else — a red `verify`, say — stays decisive.
 */
export const acceptedExcluding = (
  outcomes: readonly TStepOutcome[],
  excluded: readonly string[],
): boolean =>
  outcomes.every(
    (outcome) => excluded.includes(outcome.step) || outcome.accepted,
  )

export type TStepResult = Readonly<{
  previous: TEnvelopeBase | undefined
  /**
   * Did THIS step's own criterion hold?
   *
   * Not the same question as "did the activityRun run". A verify activityRun that ran the
   * suite did its job even when the suite came back red: the activityRun succeeds and
   * `accepted` is false, which is what `finish(accepted:)` settles.
   */
  accepted: boolean
}>

export type TStep = Readonly<{
  name: TStepName
  params: TActivityRunParams
  /** agent names this step needs, checked before anything spawns */
  requires: readonly string[]
  execute: (ctx: TStepContext, handle: TActivityRunHandle) => Promise<TStepResult>
  replay: (ctx: TStepContext) => Promise<TStepResult>
}>

/** Per-call-site knobs. `instance` disambiguates a repeated step. */
export type TStepOptions = Readonly<{
  /** `prompt`: which agent answers */
  agent: string
  /** `verify`, `review`, `code-review`, `document`: the ref or range judged; '' is the working tree */
  base: string
  /**
   * `commit`: how the work is handed over — 'branch', 'patch', or 'commit'.
   *
   * 'branch' by default, because an unattended run must not sign as the
   * developer, and because the signing prompt is the thing most likely to
   * kill a run at its last step with the work already finished.
   */
  deliver: string
  /** 1 for the first occurrence; 2+ suffixes the activityRun name (`build_2`) */
  instance: number
}>

export const DEFAULT_STEP_OPTIONS: TStepOptions = {
  agent: 'builder',
  // '' and not 'main': a step must be able to tell "no --base was given" from
  // "--base main was given", and only `document` falls back to main.
  base: '',
  deliver: 'branch',
  instance: 1,
}

/** `build`, `build_2`, `build_3` … so a composed chain can repeat a step. */
export const stepActivityRunName = (name: TStepName, instance: number): string =>
  instance <= 1 ? name : `${name}_${instance}`
