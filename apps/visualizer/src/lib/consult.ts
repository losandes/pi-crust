/**
 * Questions put to a activity after it finished, and what they changed.
 *
 * A consult is not a activity: it opens no activityRun and does not appear in the
 * waterfall. It hangs off the activityRun it asked about, so the answer is found
 * where the question made sense rather than at the end of the run.
 */
import { startedAfter } from './order'
import type { ActivityRun, EventRow } from './types'

export type TConsultMode = 'ask' | 'amend'

export type TConsult = Readonly<{
  activityRunId: string
  mode: TConsultMode
  agent: string
  question: string
  answer: string
  answered: boolean
  /** Documents of its own activity the consult rewrote. */
  amended: readonly string[]
  /** Documents of other activities it touched, which were put back. */
  restored: readonly string[]
  at: string
}>

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** Every consult in the trace, oldest first — a thread reads downwards. */
export const consultsOf = (events: readonly EventRow[]): readonly TConsult[] =>
  events
    .filter(
      (event) => event.type === 'consult' && event.activity_run_id !== null,
    )
    .flatMap((event) => {
      try {
        const payload = JSON.parse(event.payload_json ?? '{}') as Record<
          string,
          unknown
        >
        const mode = payload.mode === 'amend' ? 'amend' : 'ask'
        return [
          {
            activityRunId: event.activity_run_id ?? '',
            mode: mode as TConsultMode,
            agent: text(payload.agent),
            question: text(payload.question),
            answer: text(payload.answer),
            answered: payload.answered === true,
            amended: strings(payload.amended),
            restored: strings(payload.restored),
            at: text(payload.at) || (event.started_at ?? ''),
          },
        ]
      } catch (cause) {
        void cause
        return []
      }
    })

/** The thread belonging to one activity. */
export const consultsFor = (
  all: readonly TConsult[],
  activityRunId: string,
): readonly TConsult[] =>
  all.filter((entry) => entry.activityRunId === activityRunId)

/** A consult that has been accepted and has not answered yet. */
export type TPendingConsult = Readonly<{
  mode: TConsultMode
  question: string
}>

/**
 * The sent-and-unanswered consult, or nothing once its reply has landed.
 *
 * Cleared by the TRACE rather than by a timer. A consult rejoins a
 * conversation of a hundred thousand tokens and takes as long as the activity
 * itself did, so any timeout short enough to be useful would clear a message
 * that is still being answered — and the arrival of a consult carrying the
 * same question is the only evidence the reply actually landed.
 *
 * Matched on the question rather than on an id, because the id does not
 * exist until the event is written: the whole consult, question and answer
 * together, is recorded once at the end.
 */
export const stillPending = (
  pending: TPendingConsult | undefined,
  consults: readonly TConsult[],
): TPendingConsult | undefined =>
  pending !== undefined &&
  consults.some((one) => one.question === pending.question)
    ? undefined
    : pending

/**
 * Activities whose work was derived from a document that has since been amended.
 *
 * Inferred from ORDER, not from observed reads: nothing records which
 * documents an Activity Run actually opened, so one that ran later is treated
 * as having depended on one that ran earlier. That over-reports — an Activity
 * Run that never read the amended file is flagged anyway — and over-reporting
 * is the right direction here, because the alternative is a run whose
 * documents quietly disagree.
 *
 * "Later" is measured in TIME, not in `seq`. Under a concurrent Stage `seq`
 * is insert order, so sorting by it would call one member of a concurrent
 * pair later than the other and mark exactly one of them stale, on the
 * strength of a race. An Activity Run that STARTED after the amended one
 * finished is downstream of it; one that overlapped is not.
 *
 * An Activity Run that ran after the amendment itself is not stale: it saw
 * the new text. That comparison is the amendment's timestamp against its end.
 */
export const staleAfterAmend = (
  consults: readonly TConsult[],
  activityRuns: readonly ActivityRun[],
): ReadonlySet<string> => {
  const byId = new Map(
    activityRuns.map((activityRun) => [
      activityRun.activity_run_id,
      activityRun,
    ]),
  )
  const stale = new Set<string>()
  for (const consult of consults) {
    if (consult.mode !== 'amend' || consult.amended.length === 0) continue
    const amended = byId.get(consult.activityRunId)
    if (amended === undefined) continue
    for (const activityRun of activityRuns) {
      const ended = activityRun.ended_at ?? ''
      // The amended Activity Run is not downstream of itself. It is excluded
      // by identity rather than by time, because an instantaneous row starts
      // and ends at the same instant and would otherwise qualify.
      if (activityRun.activity_run_id === amended.activity_run_id) continue
      if (!startedAfter(activityRun, amended)) continue
      // Ran before the amendment, so it saw the older text.
      if (ended !== '' && ended < consult.at)
        stale.add(activityRun.activity_run_id)
    }
  }
  return stale
}
