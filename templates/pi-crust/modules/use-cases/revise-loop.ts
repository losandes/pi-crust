/**
 * The bounded revise loop: a chain that ends in a review answers it.
 *
 * Any chain whose last step is `review` or `code-review` feeds the blocking
 * findings back to the builder as a `revise` phase, re-reviews, and stops —
 * approved, deadlocked, or out of rounds. It is the step library's loop now,
 * not one workflow's hand-written control flow.
 *
 * Bounded at TWO revise rounds, not three. Each round costs a build-sized agent
 * call, and a third round of a disagreement nobody can settle is worse value
 * than putting it in front of the developer.
 *
 * Three rules the HARNESS applies, because neither agent may settle its own
 * disagreement:
 *
 *   - a finding a declared check decides may not be disputed at all
 *     (`gates/dispute-gates.ts` — exit status is not a matter of opinion)
 *   - a dispute must carry evidence with a shape, or the gate rejects it the
 *     way `verdict_consistent` rejects an approval that ships blocking items
 *   - a finding raised twice with no new evidence on either side ends the loop
 *     and surfaces to the developer; this file counts the repeats
 *
 * The ledger is PERSISTED (`context_handoff/disputes.json`) rather than rebuilt
 * from envelopes. `agentStep`'s replay reads `{sessionDir}/{agent}/envelope.json`,
 * which holds only an agent's LATEST envelope — so on `--resume` a replayed
 * `code-review` and `code-review_2` hand back the same object, and a ledger
 * built from them would see a repeat that never happened.
 */

import { join } from 'node:path'
import { writeText } from '../data/files'
import type { TReviewOutput } from '../typedefs/envelope'
import { buildOutput, narrowEnvelope, reviewOutput } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TStepContext, TStepOptions } from '../typedefs/step'
import { acceptedExcluding, allAccepted, DEFAULT_STEP_OPTIONS } from '../typedefs/step'
import type { TRoundRecord } from './dispute-ledger'
import { REPORT_FILENAME, renderReport } from './dispute-report'
import {
  readLedger,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from './dispute-ledger'
import { runSteps } from './run-steps'
import { STEP_REGISTRY } from './steps'

export const MAX_REVISE_ROUNDS = 2

/** Steps that end in a verdict the loop can answer. */
export const REVIEW_STEPS = ['review', 'code-review'] as const


export type TLoopOutcome =
  | 'not-applicable'
  | 'approved'
  | 'deadlocked'
  | 'exhausted'

export type TReviseLoopResult = Readonly<{
  ctx: TStepContext
  outcome: TLoopOutcome
  accepted: boolean
  reason: string
}>

/** The review step a chain ends in, or '' when it does not end in one. */
export const trailingReview = (names: readonly string[]): string => {
  const last = names.at(-1) ?? ''
  return (REVIEW_STEPS as readonly string[]).includes(last) ? last : ''
}

/** Does a chain of these names get the loop at all? */
export const loopApplies = (names: readonly string[]): boolean =>
  trailingReview(names) !== ''

/** Agents a chain needs once the loop may run — the builder joins the roster. */
export const loopAgents = (names: readonly string[]): readonly string[] =>
  loopApplies(names) ? ['builder'] : []

/** What `finish` is told, per outcome. The developer's next move is in it. */
export const outcomeReason = (
  outcome: TLoopOutcome,
  params: Readonly<{ unmoved: number; reportPath: string; fallback: string }>,
): string => {
  if (outcome === 'deadlocked') {
    return (
      `the review repeated ${params.unmoved} finding(s) the revise did not ` +
      `move, and neither side added evidence — see ${params.reportPath}`
    )
  }
  if (outcome === 'exhausted') {
    return (
      `the reviewer never approved after ${MAX_REVISE_ROUNDS} revise ` +
      `round(s) — see ${params.reportPath}`
    )
  }
  return params.fallback
}

/**
 * The verdict a context carries, or a refusal to invent one.
 *
 * A loop that reaches here without a review envelope has been composed wrong
 * (`--steps build,review` is what earns it), and guessing an empty verdict
 * would send the builder to revise against nothing.
 */
const reviewOf = (ctx: TStepContext): TReviewOutput => {
  const review = reviewFrom(ctx)
  if (review === undefined) {
    throw new Error(
      'revise loop: the step before it produced no review envelope \u2014 ' +
        'the loop only applies to a chain ending in review or code-review',
    )
  }
  return review
}

/**
 * The review a context carries, or undefined when the last step was not one.
 *
 * The step name is the discriminator, not the payload: `reviewOutputSchema`
 * accepts a build envelope and fills `approved: false` from its default, so
 * sniffing the shape would read "not approved" off work that was never judged.
 */
const reviewFrom = (ctx: TStepContext): TReviewOutput | undefined =>
  (REVIEW_STEPS as readonly string[]).includes(ctx.previousStep ?? '')
    ? narrowEnvelope(reviewOutput, ctx.previous)
    : undefined

const approvedOf = (ctx: TStepContext): boolean =>
  reviewFrom(ctx)?.approved === true

const stepFor = (
  name: string,
  options: Readonly<Partial<TStepOptions>>,
  instance: number,
): ReturnType<(typeof STEP_REGISTRY)[keyof typeof STEP_REGISTRY]> => {
  const factory = STEP_REGISTRY[name as keyof typeof STEP_REGISTRY]
  if (factory === undefined) {
    throw new Error(`revise loop: '${name}' is not a step`)
  }
  return factory({ ...DEFAULT_STEP_OPTIONS, ...options, instance })
}

type TLoopState = Readonly<{
  ctx: TStepContext
  rounds: readonly TRoundRecord[]
}>

/**
 * Run the loop. Returns what the workflow should settle the run with.
 *
 * Every phase goes through `runSteps`, so `--resume`, tracing and gates need
 * nothing new — the loop is composition, not a second driver.
 */
export const runReviseLoop = (
  run: TRun,
  params: Readonly<{
    names: readonly string[]
    options: Readonly<Partial<TStepOptions>>
    ctx: TStepContext
    fallbackReason: string
  }>,
): Promise<TReviseLoopResult> => {
  const reviewName = trailingReview(params.names)
  if (reviewName === '') {
    return Promise.resolve({
      ctx: params.ctx,
      outcome: 'not-applicable',
      accepted: allAccepted(params.ctx.outcomes),
      reason: params.fallbackReason,
    })
  }

  const settle = (
    state: TLoopState,
    outcome: TLoopOutcome,
    unmoved: readonly string[],
  ): TReviseLoopResult => {
    const reportPath = join(run.contextHandoffDir, REPORT_FILENAME)
    if (outcome === 'deadlocked' || outcome === 'exhausted') {
      writeText(reportPath, renderReport(state.rounds, unmoved))
      run.console.note(`unresolved findings written to ${reportPath}`)
    }
    return {
      ctx: state.ctx,
      outcome,
      accepted: acceptedExcluding(state.ctx.outcomes, REVIEW_STEPS) &&
        outcome === 'approved',
      reason: outcomeReason(outcome, {
        unmoved: unmoved.length,
        reportPath,
        fallback: params.fallbackReason,
      }),
    }
  }

  if (approvedOf(params.ctx)) {
    return Promise.resolve({
      ctx: params.ctx,
      outcome: 'approved',
      accepted: acceptedExcluding(params.ctx.outcomes, REVIEW_STEPS),
      reason: params.fallbackReason,
    })
  }

  // The chain's own review is round 1; it had no revise before it. A resumed
  // run reads the rounds back rather than re-deriving them from envelopes.
  const reviewsSoFar = params.names.filter(
    (name) => name === reviewName,
  ).length
  const persisted = readLedger(run)
  const opening: TLoopState = {
    ctx: params.ctx,
    rounds:
      persisted.length > 0
        ? persisted
        : [
            roundRecord({
              round: 1,
              review: reviewOf(params.ctx),
              revise: undefined,
            }),
          ],
  }

  const round = async (
    state: TLoopState,
    attempt: number,
  ): Promise<TReviseLoopResult> => {
    if (attempt > MAX_REVISE_ROUNDS) {
      return settle(state, 'exhausted', [])
    }
    const blocking =
      reviewFrom(state.ctx)?.blocking ?? []
    run.console.note(
      `revise round ${attempt} of ${MAX_REVISE_ROUNDS}: ` +
        `${blocking.length} blocking`,
    )

    // The verdict being revisited is dropped from `accepted` before the round
    // runs: it is the question the loop exists to re-ask, and leaving it in
    // would make a later approval unable to turn the run green. Everything
    // before it — a failed `verify`, say — stays, and stays decisive.
    const revised = await runSteps(
      run,
      [stepFor('revise', params.options, attempt)],
      state.ctx,
    )
    const revise = narrowEnvelope(buildOutput, revised.previous)
    const reviewed = await runSteps(
      run,
      [stepFor(reviewName, params.options, reviewsSoFar + attempt)],
      revised,
    )

    const record = roundRecord({
      round: attempt + 1,
      review: reviewOf(reviewed),
      revise,
    })
    const rounds = [...state.rounds, record]
    writeLedger(run, rounds)
    const next: TLoopState = { ctx: reviewed, rounds }

    if (approvedOf(reviewed)) {
      return settle(next, 'approved', [])
    }
    const unmoved = unmovedFindings(
      state.rounds.at(-1) ?? record,
      record,
    )
    if (unmoved.length > 0) {
      run.console.note(
        `deadlock: ${unmoved.length} finding(s) repeated with no new evidence ` +
          'on either side',
      )
      return settle(next, 'deadlocked', unmoved)
    }
    return round(next, attempt + 1)
  }

  return round(opening, 1)
}
