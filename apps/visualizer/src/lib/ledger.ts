/**
 * What a step decided, assumed, and could not settle — per phase.
 *
 * This is the half of the trust change the terminal already had and the
 * screen did not. A chain that decides its own questions instead of stopping
 * is only safe if every one of those decisions is impossible to miss
 * afterwards; otherwise raising the dial just means nobody finds out.
 *
 * Nothing new is recorded to build it. The envelope a step wrote already
 * carries `decisions`, `assumptions` and `unresolved`, and the run already
 * emits `self_answered`, `open_questions` and `human_gate_open` events as it
 * goes. This module joins the two, because each answers a different half of
 * the question: the envelope says WHAT the step held, and the events say what
 * the run then DID about it.
 *
 * Deriving the outcome from events rather than recomputing it from the trust
 * level is deliberate. The level is a number the run was started with; the
 * events are what actually happened under it. When they disagree, the events
 * are right — and a reader looking at an old run gets what that run did
 * rather than what today's rules would have done.
 */

import type { Envelope, Event as EventRow } from '../../shared/types'

/** What became of a question the step could not answer from evidence. */
export type TQuestionOutcome =
  /** the step answered it itself, because the dial allowed it */
  | 'decided'
  /** it stopped the run and came to a person */
  | 'escalated'
  /** nothing was blocked and nobody has answered it — it is yours */
  | 'open'

export type TLedgerDecision = Readonly<{
  decision: string
  rationale: string
}>

export type TLedgerAssumption = Readonly<{
  assumption: string
  invalidated_by: string
}>

export type TLedgerQuestion = Readonly<{
  question: string
  /** what the step would do, or did, unasked — '' when it had no answer */
  provisional_answer: string
  /** would a later step have had to invent this */
  consequential: boolean
  /** would acting reach outside what discarding this run would undo */
  beyond_this_run: boolean
  outcome: TQuestionOutcome
}>

export type TPhaseLedger = Readonly<{
  decisions: readonly TLedgerDecision[]
  assumptions: readonly TLedgerAssumption[]
  questions: readonly TLedgerQuestion[]
  /** everything a person is being asked to accept or act on, in one number */
  total: number
}>

export const EMPTY_LEDGER: TPhaseLedger = {
  decisions: [],
  assumptions: [],
  questions: [],
  total: 0,
}

const parsed = (json: string | null): Record<string, unknown> => {
  if (json === null || json.trim() === '') return {}
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {}
  } catch (error) {
    // A malformed payload is a row to skip, not a screen to break. The
    // envelope is written by a model and re-validated on the way in, so this
    // is the rare case rather than the expected one.
    void error
    return {}
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const flag = (value: unknown): boolean => value === true

const listOf = (payload: Record<string, unknown>, key: string): unknown[] =>
  Array.isArray(payload[key]) ? (payload[key] as unknown[]) : []

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}

/**
 * The envelope a phase produced, preferring the one that validated.
 *
 * A retried phase writes one row per attempt, and an invalid attempt is a
 * record of the correction loop rather than of what the step held. Latest
 * valid wins; if none validated, the latest row is still better than nothing,
 * because a reader asking "what did this step decide" is better served by a
 * rejected answer than by a blank panel.
 */
const envelopeFor = (
  phaseId: string,
  envelopes: readonly Envelope[],
): Envelope | undefined => {
  const mine = envelopes.filter((row) => row.phase_id === phaseId)
  const valid = mine.filter((row) => row.valid === 1)
  const pool = valid.length > 0 ? valid : mine
  return pool.reduce<Envelope | undefined>(
    (best, row) =>
      best === undefined || (row.attempt ?? 0) >= (best.attempt ?? 0)
        ? row
        : best,
    undefined,
  )
}

/** Questions this phase's run-time events say were answered by the step itself. */
const decidedQuestions = (events: readonly EventRow[]): ReadonlySet<string> =>
  new Set(
    events
      .filter((event) => event.name === 'self_answered')
      .map((event) => text(parsed(event.payload_json).question))
      .filter((question) => question !== ''),
  )

/** Questions the run reported as left open at the end of the chain. */
const openQuestions = (events: readonly EventRow[]): ReadonlySet<string> =>
  new Set(
    events
      .filter((event) => event.name === 'open_questions')
      .flatMap((event) => listOf(parsed(event.payload_json), 'questions'))
      .map((question) => text(question))
      .filter((question) => question !== ''),
  )

const gateOpened = (events: readonly EventRow[]): boolean =>
  events.some((event) => event.name === 'human_gate_open')

/**
 * What a reader is being asked to accept, for one phase.
 *
 * `events` may be the whole run's — they are filtered to the phase here, so
 * no caller has to remember to.
 */
export const phaseLedger = (
  phaseId: string,
  envelopes: readonly Envelope[],
  events: readonly EventRow[],
): TPhaseLedger => {
  const envelope = envelopeFor(phaseId, envelopes)
  if (envelope === undefined) return EMPTY_LEDGER

  const payload = parsed(envelope.payload_json)
  const mine = events.filter((event) => event.phase_id === phaseId)
  const decided = decidedQuestions(mine)
  const open = openQuestions(mine)
  const stopped = gateOpened(mine)

  const decisions = listOf(payload, 'decisions').map((entry) => {
    const row = asRecord(entry)
    return {
      decision: text(row.decision),
      rationale: text(row.rationale),
    }
  })

  const assumptions = listOf(payload, 'assumptions').map((entry) => {
    const row = asRecord(entry)
    return {
      assumption: text(row.assumption),
      invalidated_by: text(row.invalidated_by),
    }
  })

  const questions = listOf(payload, 'unresolved').map((entry) => {
    const row = asRecord(entry)
    const question = text(row.question)
    const provisional = text(row.provisional_answer)
    /*
     * Events first, inference second.
     *
     * A question named in a `self_answered` event WAS decided, whatever its
     * flags say; one named in `open_questions` was explicitly reported as
     * nobody's yet. Only when neither event mentions it do we fall back to
     * the shape of the question itself — a phase that stopped escalated
     * something, and a phase that did not had an answer or did not need one.
     */
    const outcome: TQuestionOutcome = decided.has(question)
      ? 'decided'
      : open.has(question)
        ? 'open'
        : stopped
          ? 'escalated'
          : provisional === ''
            ? 'open'
            : 'decided'
    return {
      question,
      provisional_answer: provisional,
      consequential: flag(row.consequential),
      beyond_this_run: flag(row.beyond_this_run),
      outcome,
    }
  })

  return {
    decisions,
    assumptions,
    questions,
    total: decisions.length + assumptions.length + questions.length,
  }
}

/**
 * How many of a phase's entries are the kind that stop a reader.
 *
 * A tab badge wants one number, and "everything in the ledger" is the wrong
 * one — a step with nine assumptions and no open questions is not asking for
 * anything. What counts is what a person still has to act on.
 */
export const needsYou = (ledger: TPhaseLedger): number =>
  ledger.questions.filter((question) => question.outcome !== 'decided').length

/** The same ledger, for every phase in a run, keyed by phase_id. */
export const runLedger = (
  phaseIds: readonly string[],
  envelopes: readonly Envelope[],
  events: readonly EventRow[],
): ReadonlyMap<string, TPhaseLedger> =>
  new Map(
    phaseIds.map((phaseId) => [
      phaseId,
      phaseLedger(phaseId, envelopes, events),
    ]),
  )
