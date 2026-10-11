/**
 * Questions put to a step after it finished, and what they changed.
 *
 * A consult is not a step: it opens no activityRun and does not appear in the
 * waterfall. It hangs off the activityRun it asked about, so the answer is found
 * where the question made sense rather than at the end of the run.
 */
import type { EventRow, ActivityRun } from './types'

export type TConsultMode = 'ask' | 'amend'

export type TConsult = Readonly<{
  activityRunId: string
  mode: TConsultMode
  agent: string
  question: string
  answer: string
  answered: boolean
  /** Documents of its own step the consult rewrote. */
  amended: readonly string[]
  /** Documents of other steps it touched, which were put back. */
  restored: readonly string[]
  at: string
}>

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Every consult in the trace, oldest first — a thread reads downwards. */
export const consultsOf = (events: readonly EventRow[]): readonly TConsult[] =>
  events
    .filter((event) => event.type === 'consult' && event.activity_run_id !== null)
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

/** The thread belonging to one step. */
export const consultsFor = (
  all: readonly TConsult[],
  activityRunId: string,
): readonly TConsult[] => all.filter((entry) => entry.activityRunId === activityRunId)

/**
 * Steps whose work was derived from a document that has since been amended.
 *
 * Inferred from ORDER, not from observed reads: nothing records which
 * documents a step actually opened, so a later step is treated as having
 * depended on an earlier one. That over-reports — a step that never read the
 * amended file is flagged anyway — and over-reporting is the right direction
 * here, because the alternative is a run whose documents quietly disagree.
 *
 * A step that ran AFTER the amendment is not stale: it already saw the new
 * text. The comparison is the amendment's timestamp against the step's end.
 */
export const staleAfterAmend = (
  consults: readonly TConsult[],
  activityRuns: readonly ActivityRun[],
): ReadonlySet<string> => {
  const seqOf = new Map(activityRuns.map((activityRun) => [activityRun.activity_run_id, activityRun.seq ?? 0]))
  const stale = new Set<string>()
  for (const consult of consults) {
    if (consult.mode !== 'amend' || consult.amended.length === 0) continue
    const amendedSeq = seqOf.get(consult.activityRunId) ?? 0
    for (const activityRun of activityRuns) {
      const ended = activityRun.ended_at ?? ''
      if ((activityRun.seq ?? 0) <= amendedSeq) continue
      // Ran before the amendment, so it saw the older text.
      if (ended !== '' && ended < consult.at) stale.add(activityRun.activity_run_id)
    }
  }
  return stale
}
