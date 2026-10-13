/**
 * The bounded revise loop: a chain that ends in a review answers it.
 *
 * Any chain whose last activity is `review` or `code-review` feeds the blocking
 * findings back to the builder as a `revise` activityRun, re-reviews, and stops —
 * approved, deadlocked, or out of rounds. It is the activity library's loop now,
 * not one workflow's hand-written control flow.
 *
 * Bounded by the `revise` instance's own attempt budget, which is the
 * reviser's `attempts` — the same ceiling a gate failure and a regression
 * spend from. Each round costs a build-sized agent call, and a round of a
 * disagreement nobody can settle is worse value than putting it in front of
 * the developer; a team that disagrees raises `attempts` on the Activity
 * doing the revising, in one place, for all three.
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
import type { TActivityConfig } from '../typedefs/activity'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TReviewOutput } from '../typedefs/envelope'
import { buildOutput, narrowEnvelope, reviewOutput } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TActivity, TActivityContext, TActivityOptions } from '../typedefs/runnable-activity'
import { acceptedExcluding, allAccepted, DEFAULT_ACTIVITY_OPTIONS } from '../typedefs/runnable-activity'
import type { TAttemptLedger } from './attempts'
import { attemptLedger, reviseCause } from './attempts'
import type { TRoundRecord } from './dispute-ledger'
import { REPORT_FILENAME, renderReport } from './dispute-report'
import {
  readLedger,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from './dispute-ledger'
import { disputesSupported } from './gates'
import { runActivities } from './run-activities'
import { agentActivity, runnableActivities } from './activities'

/** The Activity Run name every round of the loop runs under. */
export const REVISE = 'revise'

/**
 * Activities that end in a verdict the loop can answer.
 *
 * `review` is kept beside `outcome-review` because the name is configuration:
 * the shipped registry renamed its outcome reviewer, and a repository whose
 * `crust.activities.local.yaml` or own chain still says `review` would
 * otherwise lose the loop silently — the chain would run and simply never
 * send findings back.
 */
export const REVIEW_STEPS = ['outcome-review', 'review', 'code-review'] as const


export type TLoopOutcome =
  | 'not-applicable'
  | 'approved'
  | 'deadlocked'
  | 'exhausted'

export type TReviseLoopResult = Readonly<{
  ctx: TActivityContext
  outcome: TLoopOutcome
  accepted: boolean
  reason: string
}>

/** The review activity a chain ends in, or '' when it does not end in one. */
export const trailingReview = (names: readonly string[]): string => {
  const last = names.at(-1) ?? ''
  return (REVIEW_STEPS as readonly string[]).includes(last) ? last : ''
}

/** Does a chain of these names get the loop at all? */
export const loopApplies = (names: readonly string[]): boolean =>
  trailingReview(names) !== ''

/**
 * The Activity that answers a review, and the prompts the round runs with.
 *
 * `revise` is no longer a registry entry: no Lifecycle names it, and an
 * entry nothing can name is an entry that drifts. The loop invokes the
 * WRITER itself — the last Activity in the chain whose contract is a
 * `buildOutput`, which is the one whose work is being judged — with the
 * dispute gate added and the findings in its prompt.
 */
export const reviserFor = (
  cfg: TPiCrustConfig,
  names: readonly string[],
): TActivityConfig | undefined => {
  const writers = names.flatMap((name) => {
    const activity = cfg.activities.find((one) => one.name === name)

    return activity !== undefined && activity.output === buildOutput.name
      ? [activity]
      : []
  })

  return writers.at(-1) ?? cfg.activities.find((one) => one.name === 'build')
}

/** Agents a chain needs once the loop may run — the reviser joins the roster. */
export const loopAgents = (
  cfg: TPiCrustConfig,
  names: readonly string[],
): readonly string[] => {
  const reviser = loopApplies(names) ? reviserFor(cfg, names) : undefined

  return reviser === undefined ? [] : [reviser.name]
}

/**
 * The reviser, as a activity named `revise`.
 *
 * Its own output type and prompts, plus `disputesSupported`, which is what
 * stops "I disagree" being an answer. Every round runs under the same
 * Activity Run name, so every round comes out of one budget rather than
 * minting a fresh one by calling itself `revise_2`.
 */
export const reviseActivity = (
  reviser: TActivityConfig,
  options: Readonly<Partial<TActivityOptions>>,
): TActivity => {
  const activity = agentActivity(
    {
      config: {
        ...reviser,
        gates: [...reviser.gates, 'disputesSupported'],
        purpose:
          'Answer every blocking finding the review named — fix it, or ' +
          'dispute it with evidence',
      },
      spec: buildOutput,
      gates: [disputesSupported],
    },
    { ...DEFAULT_ACTIVITY_OPTIONS, ...options, instance: 1 },
  )

  return { ...activity, name: REVISE, instance: REVISE, params: { ...activity.params, name: REVISE } }
}

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
      'the reviewer never approved, and the revising activity has no ' +
      `attempts left — see ${params.reportPath}`
    )
  }
  return params.fallback
}

/**
 * The verdict a context carries, or a refusal to invent one.
 *
 * A loop that reaches here without a review envelope has been composed wrong
 * (`--activities build,review` is what earns it), and guessing an empty verdict
 * would send the builder to revise against nothing.
 */
const reviewOf = (ctx: TActivityContext): TReviewOutput => {
  const review = reviewFrom(ctx)
  if (review === undefined) {
    throw new Error(
      'revise loop: the activity before it produced no review envelope \u2014 ' +
        'the loop only applies to a chain ending in review or code-review',
    )
  }
  return review
}

/**
 * The review a context carries, or undefined when the last activity was not one.
 *
 * The activity name is the discriminator, not the payload: `reviewOutputSchema`
 * accepts a build envelope and fills `approved: false` from its default, so
 * sniffing the shape would read "not approved" off work that was never judged.
 */
const reviewFrom = (ctx: TActivityContext): TReviewOutput | undefined =>
  (REVIEW_STEPS as readonly string[]).includes(ctx.previousStep ?? '')
    ? narrowEnvelope(reviewOutput, ctx.previous)
    : undefined

const approvedOf = (ctx: TActivityContext): boolean =>
  reviewFrom(ctx)?.approved === true

type TLoopState = Readonly<{
  ctx: TActivityContext
  rounds: readonly TRoundRecord[]
}>

/**
 * Run the loop. Returns what the workflow should settle the run with.
 *
 * Every activityRun goes through `runActivities`, so `--resume`, tracing and gates need
 * nothing new — the loop is composition, not a second driver.
 */
export const runReviseLoop = (
  run: TRun,
  params: Readonly<{
    names: readonly string[]
    options: Readonly<Partial<TActivityOptions>>
    ctx: TActivityContext
    fallbackReason: string
    /** the run's one budget; the loop spends from it like everything else */
    ledger?: TAttemptLedger
  }>,
): Promise<TReviseLoopResult> => {
  const ledger = params.ledger ?? attemptLedger()
  const reviser = reviserFor(run.cfg, params.names)
  const reviewName = trailingReview(params.names)
  if (reviewName === '' || reviser === undefined) {
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
    /*
     * The ceiling is the reviser's own `attempts`, spent against the single
     * `revise` instance. A round IS an Activity Run of it, so the loop has
     * no count of its own to keep and cannot disagree with the budget every
     * other re-execution comes out of.
     */
    if (ledger.remaining(REVISE, reviser.attempts) === 0) {
      run.console.note(ledger.report(REVISE, reviser.attempts))

      return settle(state, 'exhausted', [])
    }
    const blocking = reviewFrom(state.ctx)?.blocking ?? []
    run.console.note(
      `revise round ${attempt} (${ledger.remaining(REVISE, reviser.attempts)} ` +
        `attempt(s) left): ${blocking.length} blocking`,
    )
    ledger.spend(REVISE, reviseCause(attempt))

    // The verdict being revisited is dropped from `accepted` before the round
    // runs: it is the question the loop exists to re-ask, and leaving it in
    // would make a later approval unable to turn the run green. Everything
    // before it — a failed `verify`, say — stays, and stays decisive.
    const revised = await runActivities({
      run,
      activities: [reviseActivity(reviser, params.options)],
      start: {
        ...state.ctx,
        /*
         * The findings travel in the prompt, the way a gate's violations do.
         * Without them the round is the first attempt again, at the same
         * price and with the same result.
         */
        feedback: blocking,
      },
      ledger,
    })
    const revise = narrowEnvelope(buildOutput, revised.previous)
    const reviewed = await runActivities({
      run,
      activities: runnableActivities([reviewName], run.cfg, {
        ...params.options,
        instance: reviewsSoFar + attempt,
      }),
      start: { ...revised, feedback: [] },
      ledger,
    })

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
