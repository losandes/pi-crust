/**
 * What happened to this RUN, as opposed to one of its activities.
 *
 * A note typed when picking the run back up, and the two halves of a branch
 * — where this run came from, and where it went — are facts about the run as
 * a whole rather than about any one activity run, so they live beside the
 * run's own controls rather than inside an Activity Run's conversation.
 */

import type { EventRow } from './types'

export type TRunNotice =
  | Readonly<{ kind: 'note'; text: string; from: string; at: string }>
  | Readonly<{ kind: 'branched_from'; runId: string; activity: string; at: string }>
  | Readonly<{ kind: 'branched_to'; runId: string; activity: string; at: string }>

const payloadOf = (event: EventRow): Readonly<Record<string, unknown>> => {
  if (!event.payload_json) return {}
  // biome-ignore lint/plugin/no-intermediate-try-catch: a malformed payload is this function's own answer, one dropped notice, never a broken page
  try {
    const parsed: unknown = JSON.parse(event.payload_json)
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (cause) {
    void cause
    return {}
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Every run-scoped notice this run carries, oldest first.
 *
 * A malformed payload produces no entry rather than throwing — this reads a
 * trace a run wrote, and a reader is owed everything that parses rather than
 * nothing because one event did not.
 */
export const runNoticesOf = (events: readonly EventRow[]): readonly TRunNotice[] =>
  events
    .flatMap((event): readonly TRunNotice[] => {
      const payload = payloadOf(event)
      if (event.type === 'log' && event.name === 'developer_note') {
        const text = str(payload.note)
        if (text === '') return []
        return [{ kind: 'note', text, from: str(payload.from) || 'a developer', at: str(payload.at) }]
      }
      if (event.type === 'log' && event.name === 'branched_from') {
        const runId = str(payload.from_run_id)
        const activity = str(payload.activity)
        if (runId === '' || activity === '') return []
        return [{ kind: 'branched_from', runId, activity, at: str(payload.at) }]
      }
      if (event.type === 'steer' && (event.name ?? '').startsWith('branch ')) {
        if (payload.target !== 'branch') return []
        const runId = str(payload.branch_run_id)
        const activity = str(payload.activity)
        if (runId === '' || activity === '') return []
        return [{ kind: 'branched_to', runId, activity, at: str(payload.at) }]
      }
      return []
    })
    .toSorted((a, b) => a.at.localeCompare(b.at))
