/**
 * The bounded revise loop: a chain that ends in a review answers it.
 *
 * A chain that ends in reviewing Activities — any whose registry entry
 * declares `output: reviewOutput`, whatever a team named them — feeds their
 * blocking findings back to the builder as a `revise` activityRun, re-asks
 * every one of them, and stops: approved, deadlocked, or out of rounds. It is
 * the activity library's loop now, not one workflow's hand-written control
 * flow.
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
import type {
  TActivity,
  TActivityConfig,
  TActivityContext,
  TActivityOptions,
  TActivityOutcome,
  TPiCrustConfig,
  TReviewOutput,
  TRun,
} from '../../../../lib/contracts'
import {
  acceptedExcluding,
  allAccepted,
  buildOutput,
  DEFAULT_ACTIVITY_OPTIONS,
  envelopeNamed,
  narrowEnvelope,
  reviewOutput,
} from '../../../../lib/contracts'
import { writeText } from '../../../../lib/system'
import { agentActivity, runnableActivities } from '../../../activities'
import type { TRoundRecord } from '../../../gates'
import {
  disputesSupported,
  REPORT_FILENAME,
  readLedger,
  renderReport,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from '../../../gates'
import type { TAttemptLedger } from './attempts'
import { attemptLedger, reviseCause } from './attempts'
import { runActivities, runUnits } from './run-activities'

/** The Activity Run name every round of the loop runs under. */
export const REVISE = 'revise'

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

/**
 * Does this Activity rule on a change somebody else made?
 *
 * The registry answers, never a list of names kept here. An Activity is a
 * review because its entry declares `output: reviewOutput` — the same
 * evidence `envelopeAccepted` already trusts to decide whether a rejection
 * counts, and configuration rather than code, so a team that names its
 * reviewer anything at all keeps the loop.
 *
 * Resolved through `envelopeNamed` rather than compared to `reviewOutput.name`:
 * an entry names the CATALOGUE KEY (`reviewOutput`) and the spec's own name is
 * `ReviewOutput`, so comparing the two strings is always false.
 *
 * The payload cannot answer this: `reviewOutputSchema` parses a build
 * envelope and fills `approved: false` from its default, so sniffing the
 * shape would read "not approved" off work that was never judged.
 */
const judges = (cfg: TPiCrustConfig, name: string): boolean => {
  const activity = cfg.activities.find((one) => one.name === name)

  return (
    activity !== undefined && envelopeNamed(activity.output) === reviewOutput
  )
}

/**
 * The reviews a chain ends in: the longest suffix of judging Activities.
 *
 * A suffix rather than every review in the chain, because a chain may review,
 * build again and review again — the earlier verdict belongs to work that has
 * since changed, and is not the question this loop re-asks. Empty when the
 * chain does not end in a review, which is what settles `not-applicable`.
 *
 * The whole suffix rather than its last entry, because acceptance sets aside
 * exactly what the loop re-asks: the shipped `accept` Stage holds two
 * reviewers, and discarding a verdict nobody revisited is how a run came back
 * green over a live rejection.
 */
export const trailingReviews = (
  names: readonly string[],
  cfg: TPiCrustConfig,
): readonly string[] => {
  const from = names.findLastIndex((name) => !judges(cfg, name)) + 1

  return names.slice(from)
}

/** Does a chain of these names get the loop at all? */
export const loopApplies = (
  names: readonly string[],
  cfg: TPiCrustConfig,
): boolean => trailingReviews(names, cfg).length > 0

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
  const reviser = loopApplies(names, cfg) ? reviserFor(cfg, names) : undefined

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

  return {
    ...activity,
    name: REVISE,
    instance: REVISE,
    params: { ...activity.params, name: REVISE },
  }
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
 * Every verdict the trailing group handed back, for the round record.
 *
 * `upstream` carries one envelope per Activity of the Stage that just ran,
 * which is where a concurrent `accept` Stage leaves both reviews. A group
 * member that ran in an EARLIER Stage is not in it — a chain spelled out as
 * `build,outcome-review,code-review` is three Stages — so its findings reach
 * the loop in the round that re-asks it rather than in the opening record.
 * Its verdict is never missed, because acceptance reads the outcomes.
 */
const reviewsIn = (
  ctx: TActivityContext,
  group: readonly string[],
): readonly TReviewOutput[] => {
  const carried = ctx.upstream.filter((one) => group.includes(one.activity))
  const envelopes =
    carried.length > 0
      ? carried.map((one) => one.envelope)
      : group.includes(ctx.previousStep ?? '') && ctx.previous !== undefined
        ? [ctx.previous]
        : []

  return envelopes.flatMap((envelope) => {
    const review = narrowEnvelope(reviewOutput, envelope)

    return review === undefined ? [] : [review]
  })
}

/**
 * The verdicts a context carries, or a refusal to invent one.
 *
 * A loop that reaches here with no review envelope at all has been composed
 * wrong, and guessing an empty verdict would send the builder to revise
 * against nothing.
 */
const reviewsOf = (
  ctx: TActivityContext,
  group: readonly string[],
): readonly TReviewOutput[] => {
  const reviews = reviewsIn(ctx, group)
  if (reviews.length === 0) {
    throw new Error(
      'revise loop: the Stage before it produced no review envelope — the ' +
        'loop only applies to a chain ending in an Activity whose registry ' +
        'entry declares `output: reviewOutput`',
    )
  }

  return reviews
}

/**
 * Did every re-asked review approve?
 *
 * Read from the outcomes rather than from the envelopes, because an outcome
 * exists for every member whether or not its envelope is still reachable,
 * and because `envelopeAccepted` already decided what approval means for a
 * review contract. One rejection in the group opens another round: a group
 * is approved when nobody in it is still saying no.
 *
 * The LAST outcome per member, because a member re-asked by a previous round
 * has more than one.
 */
export const groupApproved = (
  outcomes: readonly TActivityOutcome[],
  group: readonly string[],
): boolean =>
  group.every(
    (name) =>
      outcomes.findLast((outcome) => outcome.activity === name)?.accepted ===
      true,
  )

const approvedOf = (ctx: TActivityContext, group: readonly string[]): boolean =>
  groupApproved(ctx.outcomes, group)

/**
 * The group re-asked, as an Activity Run name and the instance it runs under.
 *
 * Numbered past what the chain itself already spent on each member, so a
 * re-ask is `code-review_2` rather than a second `code-review` sharing one
 * instance — which is also the budget each is kept against.
 */
export const reAskedInstances = (
  names: readonly string[],
  group: readonly string[],
  attempt: number,
): readonly Readonly<{ name: string; instance: number }>[] =>
  group.map((name) => ({
    name,
    instance: names.filter((one) => one === name).length + attempt,
  }))

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
  const group = trailingReviews(params.names, run.cfg)
  if (group.length === 0 || reviser === undefined) {
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
      /*
       * Exactly the verdicts this loop re-asks are set aside, and no
       * others. A rejection nobody revisited stays decisive: excluding it
       * would report a run accepted over a reviewer that is still saying
       * no.
       */
      accepted:
        acceptedExcluding(state.ctx.outcomes, group) && outcome === 'approved',
      reason: outcomeReason(outcome, {
        unmoved: unmoved.length,
        reportPath,
        fallback: params.fallbackReason,
      }),
    }
  }

  if (approvedOf(params.ctx, group)) {
    return Promise.resolve({
      ctx: params.ctx,
      outcome: 'approved',
      accepted: acceptedExcluding(params.ctx.outcomes, group),
      reason: params.fallbackReason,
    })
  }

  /** The group, re-asked: one Activity Run each, numbered past the chain's. */
  const reAsked = (attempt: number): readonly TActivity[] =>
    reAskedInstances(params.names, group, attempt).flatMap((one) =>
      runnableActivities([one.name], run.cfg, {
        ...params.options,
        instance: one.instance,
      }),
    )

  // The chain's own review is round 1; it had no revise before it. A resumed
  // run reads the rounds back rather than re-deriving them from envelopes.
  const persisted = readLedger(run)
  const opening: TLoopState = {
    ctx: params.ctx,
    rounds:
      persisted.length > 0
        ? persisted
        : [
            roundRecord({
              round: 1,
              reviews: reviewsOf(params.ctx, group),
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
    /*
     * Every re-asked reviewer's findings, in one round. A builder told about
     * the first reviewer's list and then, a round later, about the second's
     * pays twice for one disagreement it could have answered at once.
     */
    const blocking = [
      ...new Set(reviewsIn(state.ctx, group).flatMap((one) => one.blocking)),
    ]
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
    /*
     * One Unit, so every member of the group judges the SAME context — the
     * revise that just ran — rather than the member before it. Serial within
     * the Unit: they are re-asked in the order the chain named them, and a
     * concurrent Unit here would attribute writes by declarations this loop
     * never validated as a Stage.
     */
    const reviewed = await runUnits({
      run,
      units: [
        {
          stage: REVISE,
          strategy: 'serial' as const,
          activities: reAsked(attempt),
          endsStage: true,
        },
      ],
      start: { ...revised, feedback: [] },
      ledger,
    })

    const record = roundRecord({
      round: attempt + 1,
      reviews: reviewsOf(reviewed, group),
      revise,
    })
    const rounds = [...state.rounds, record]
    writeLedger(run, rounds)
    const next: TLoopState = { ctx: reviewed, rounds }

    if (approvedOf(reviewed, group)) {
      return settle(next, 'approved', [])
    }
    const unmoved = unmovedFindings(state.rounds.at(-1) ?? record, record)
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
