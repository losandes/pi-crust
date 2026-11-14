/**
 * The bounded revise loop: each review group answers to its preceding writer.
 *
 * Consecutive judging Activities — any whose registry entry declares
 * `output: reviewOutput` — feed their blocking findings back to that writer,
 * re-ask every member, and settle approved, deadlocked, or out of rounds.
 *
 * Bounded by the group's Activity Run attempt budget, which is the
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
 * Each group's ledger is PERSISTED in the handoff directory rather than rebuilt
 * from envelopes. Replay keeps only a participant's LATEST envelope, not one
 * per attempt — so on `--resume` a replayed `code-review` and `code-review_2`
 * hand back the same object, and a ledger built from them would see a repeat
 * that never happened.
 */

import { join } from 'node:path'
import type {
  TActivity,
  TActivityConfig,
  TActivityContext,
  TActivityOptions,
  TActivityOutcome,
  TBuildOutput,
  TEnvelopeBase,
  TEnvelopeSpec,
  TPiCrustConfig,
  TPlanOutput,
  TReviewOutput,
  TRun,
} from '../../../../lib/contracts'
import {
  acceptedExcluding,
  activityRunName,
  allAccepted,
  buildOutput,
  DEFAULT_ACTIVITY_OPTIONS,
  envelopeNamed,
  narrowEnvelope,
  reviewOutput,
} from '../../../../lib/contracts'
import { writeText } from '../../../../lib/system'
import type { TAgentPorts } from '../../../activities'
import { agentActivity, runnableActivities } from '../../../activities'
import type { TRoundRecord } from '../../../gates'
import {
  disputeFilename,
  disputesSupported,
  readLedger,
  renderReport,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from '../../../gates'
import type { TAttemptLedger } from './attempts'
import { attemptLedger, reviseCause } from './attempts'
import { runActivities, runUnits } from './run-activities'

/** Preserve the trailing build-contract loop's name; other groups get their writer's. */
export const reviseName = (
  reviser: Readonly<Pick<TActivityConfig, 'name' | 'output'>>,
  trailing: boolean,
  instance = 1,
): string =>
  trailing && envelopeNamed(reviser.output) === buildOutput
    ? 'revise'
    : activityRunName(`revise-${reviser.name}`, instance)

export type TReviewGroup = Readonly<{
  /** the judging Activities, in chain order */
  members: readonly string[]
  /** index of the first member in the chain */
  at: number
}>

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

/** Every maximal run of judging Activities, regardless of Stage boundaries. */
export const reviewGroups = (
  names: readonly string[],
  cfg: TPiCrustConfig,
): readonly TReviewGroup[] => {
  const judging = names.map((name) => judges(cfg, name))
  const boundaries = judging.flatMap((one, at) =>
    one === (judging[at - 1] ?? false) ? [] : [at],
  )
  return boundaries.flatMap((at, which) =>
    judging[at]
      ? [{ members: names.slice(at, boundaries[which + 1]), at }]
      : [],
  )
}

/** Does a chain of these names get the loop at all? */
export const loopApplies = (
  names: readonly string[],
  cfg: TPiCrustConfig,
): boolean => reviewGroups(names, cfg).length > 0

/**
 * The Activity that answers a review, and the prompts the round runs with.
 *
 * `revise` is no longer a registry entry: no Lifecycle names it, and an
 * entry nothing can name is an entry that drifts. The loop invokes the
 * WRITER itself — the nearest non-judging Activity before this group —
 * with the dispute gate added and the findings in its prompt.
 */
export const reviserFor = (
  cfg: TPiCrustConfig,
  names: readonly string[],
  group: TReviewGroup,
): TActivityConfig | undefined => {
  const writer = names.slice(0, group.at).findLast((name) => !judges(cfg, name))

  return cfg.activities.find((one) => one.name === writer)
}

/** Catalogue schemas declare the two fields a revise round consumes. */
const supportsRevision = (
  spec: TEnvelopeSpec<TEnvelopeBase> | undefined,
): spec is TEnvelopeSpec<TBuildOutput | TPlanOutput> =>
  spec !== undefined &&
  ['disputes', 'changed_files'].every((field) =>
    spec.fieldNames.includes(field),
  )

/** Agents a chain needs once the loop may run — the reviser joins the roster. */
export const loopAgents = (
  cfg: TPiCrustConfig,
  names: readonly string[],
): readonly string[] => {
  return [
    ...new Set(
      reviewGroups(names, cfg).flatMap((group) => {
        const reviser = reviserFor(cfg, names, group)

        return reviser !== undefined &&
          supportsRevision(envelopeNamed(reviser.output))
          ? [reviser.name]
          : []
      }),
    ),
  ]
}

/**
 * The reviser, under the group's Activity Run name.
 *
 * Its own output type and prompts, plus `disputesSupported`, which is what
 * stops "I disagree" being an answer. Every round runs under the same
 * Activity Run name, so every round comes out of one budget rather than
 * minting a fresh one by calling itself `revise_2`.
 */
export const reviseActivity = (
  reviser: TActivityConfig,
  options: Readonly<Partial<TActivityOptions>>,
  agentPorts?: TAgentPorts,
  name = reviseName(reviser, true),
): TActivity => {
  const spec = envelopeNamed(reviser.output)
  if (!supportsRevision(spec)) {
    throw new Error(`'${reviser.name}' has no revisable envelope contract`)
  }
  const activity = agentActivity(
    {
      config: {
        ...reviser,
        gates: [...reviser.gates, 'disputesSupported'],
        purpose:
          'Answer every blocking finding the review named — fix it, or ' +
          'dispute it with evidence',
      },
      spec,
      gates: [disputesSupported],
    },
    { ...DEFAULT_ACTIVITY_OPTIONS, ...options, instance: 1 },
    agentPorts,
  )

  return {
    ...activity,
    name,
    instance: name,
    params: { ...activity.params, name },
    replay: (ctx) => activity.replay(ctx, name),
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
 * Every named verdict the group handed back, for the round record.
 *
 * `upstream` carries the run's latest envelope per participant, so every
 * group member is available even when the reviews ran in separate Stages.
 * Select by the producing Activity's name, not by an envelope's shape: a
 * writer's envelope can also parse as a review because of schema defaults.
 */
type TGroupReview = Readonly<{ activity: string; review: TReviewOutput }>

const reviewsIn = (
  ctx: TActivityContext,
  group: readonly string[],
): readonly TGroupReview[] => {
  const carried = ctx.upstream.filter((one) => group.includes(one.activity))

  return carried.flatMap((one) => {
    const review = narrowEnvelope(reviewOutput, one.envelope)

    return review === undefined ? [] : [{ activity: one.activity, review }]
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
): readonly TGroupReview[] => {
  const reviews = reviewsIn(ctx, group)
  if (reviews.length === 0) {
    throw new Error(
      'revise loop: the Stage before it produced no review envelope — the ' +
        'loop only applies to a group of Activities whose registry ' +
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
    /** the boundary being settled; defaults to the last group for direct callers */
    group?: TReviewGroup
    options: Readonly<Partial<TActivityOptions>>
    ctx: TActivityContext
    fallbackReason: string
    /** the run's one budget; the loop spends from it like everything else */
    ledger?: TAttemptLedger
    /** In-process agent boundary for driver tests; omitted for live runs. */
    agentPorts?: TAgentPorts
  }>,
): Promise<TReviseLoopResult> => {
  const ledger = params.ledger ?? attemptLedger()
  const selected = params.group ?? reviewGroups(params.names, run.cfg).at(-1)
  const notApplicable = (): Promise<TReviseLoopResult> =>
    Promise.resolve({
      ctx: params.ctx,
      outcome: 'not-applicable',
      accepted: allAccepted(params.ctx.outcomes),
      reason: params.fallbackReason,
    })
  if (selected === undefined) {
    return notApplicable()
  }
  const group = selected.members
  const reviser = reviserFor(run.cfg, params.names, selected)
  if (reviser === undefined) {
    run.console.note(
      `review group [${group.join(', ')}] is not applicable: no preceding writer`,
    )
    return notApplicable()
  }
  const spec = envelopeNamed(reviser.output)
  if (!supportsRevision(spec)) {
    const missing = ['disputes', 'changed_files'].filter(
      (field) => !spec?.fieldNames.includes(field),
    )
    run.console.note(
      `review group [${group.join(', ')}] is not applicable: '${reviser.name}' ` +
        `lacks ${missing.join(' and ')} in ${reviser.output}`,
    )
    return notApplicable()
  }
  const occurrence = reviewGroups(params.names, run.cfg).filter(
    (one) =>
      one.at <= selected.at &&
      reviserFor(run.cfg, params.names, one)?.name === reviser.name,
  ).length
  const name = reviseName(
    reviser,
    selected.at + group.length === params.names.length,
    occurrence,
  )

  const settle = (
    state: TLoopState,
    outcome: TLoopOutcome,
    unmoved: readonly string[],
  ): TReviseLoopResult => {
    const reportPath = join(run.contextHandoffDir, disputeFilename(name, 'md'))
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
      runnableActivities(
        [one.name],
        run.cfg,
        {
          ...params.options,
          instance: one.instance,
        },
        params.agentPorts,
      ),
    )

  // The chain's own review is round 1; it had no revise before it. A resumed
  // run reads the rounds back rather than re-deriving them from envelopes.
  const persisted = readLedger(run, name)
  const initialReviews = reviewsOf(params.ctx, group)
  const opening: TLoopState = {
    ctx: params.ctx,
    rounds:
      persisted.length > 0
        ? persisted
        : [
            roundRecord({
              round: 1,
              reviews: initialReviews.map((one) => one.review),
              reviewers: initialReviews.map((one) => one.activity),
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
     * group instance. A round IS an Activity Run of it, so the loop has
     * no count of its own to keep and cannot disagree with the budget every
     * other re-execution comes out of.
     */
    if (ledger.remaining(name, reviser.attempts) === 0) {
      run.console.note(ledger.report(name, reviser.attempts))

      return settle(state, 'exhausted', [])
    }
    /*
     * Every re-asked reviewer's findings, in one round. A builder told about
     * the first reviewer's list and then, a round later, about the second's
     * pays twice for one disagreement it could have answered at once.
     */
    const blocking = [
      ...new Set(
        reviewsIn(state.ctx, group).flatMap((one) => one.review.blocking),
      ),
    ]
    run.console.note(
      `${name} round ${attempt} (${ledger.remaining(name, reviser.attempts)} ` +
        `attempt(s) left): ${blocking.length} blocking`,
    )
    // The verdict being revisited is dropped from `accepted` before the round
    // runs: it is the question the loop exists to re-ask, and leaving it in
    // would make a later approval unable to turn the run green. Everything
    // before it — a failed `verify`, say — stays, and stays decisive.
    const answering = state.ctx.upstream.find((one) =>
      group.includes(one.activity),
    )
    const revising = reviseActivity(
      reviser,
      params.options,
      params.agentPorts,
      name,
    )
    const revised = await runActivities({
      run,
      activities: [
        {
          ...revising,
          execute: (ctx, handle) =>
            revising.execute(
              {
                ...ctx,
                // Only the reviser's input is overridden. The fold still carries
                // the superseding work, including when this is a cached replay.
                previous: answering?.envelope,
                previousStep: answering?.activity,
              },
              handle,
            ),
        },
      ],
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
      cause: reviseCause(attempt),
    })
    const revise = narrowEnvelope(
      spec,
      revised.upstream.find((one) => one.activity === name)?.envelope,
    )
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
          stage: name,
          strategy: 'serial' as const,
          activities: reAsked(attempt),
          endsStage: true,
        },
      ],
      start: { ...revised, feedback: [] },
      ledger,
    })

    const reviews = reviewsOf(reviewed, group)
    const record = roundRecord({
      round: (state.rounds.at(-1)?.round ?? 1) + 1,
      reviews: reviews.map((one) => one.review),
      reviewers: reviews.map((one) => one.activity),
      revise,
    })
    const rounds = [...state.rounds, record]
    writeLedger(run, rounds, name)
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
