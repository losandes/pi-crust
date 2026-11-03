/**
 * What a run saw in the working tree and could not attribute.
 *
 * The factory never puts a file back: a developer editing the same branch
 * while a run works is a supported way to use this tool, and nothing in a
 * diff distinguishes their save from an agent's write. So an unexplained
 * change is reported, and this is the browser's half of reporting it.
 *
 * Read from the run's own `tree_warning` events rather than recomputed here.
 * The comparison needs three sets that only existed while the Activity Run
 * was happening — what changed, what was already dirty, what the Activity
 * claimed — and a page that tried to rebuild it would be reading a tree that
 * has moved on since.
 */
import type { EventRow } from './types'

/** Must match the runtime's `WARNING_EVENT`, which writes these rows. */
export const WARNING_EVENT = 'tree_warning'

export type TWarningKind = 'unexpected' | 'overstep' | 'refusal' | 'uncommitted'

export type TTreeWarning = Readonly<{
  kind: TWarningKind
  /** the Activities that were running; several when a Stage was concurrent */
  activities: readonly string[]
  activityRunIds: readonly string[]
  stage: string
  paths: readonly string[]
  note: string
}>

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const parse = (event: EventRow): TTreeWarning | undefined => {
  if (event.name !== WARNING_EVENT) return undefined
  let payload: Record<string, unknown> = {}
  // biome-ignore lint/plugin/no-intermediate-try-catch: a malformed payload is this function's own answer — one dropped warning, never a broken page
  try {
    payload = JSON.parse(event.payload_json ?? '{}') as Record<string, unknown>
  } catch {
    // A malformed payload costs this one warning, never the page that would
    // have shown the others.
    return undefined
  }
  const kind = payload.kind
  if (
    kind !== 'unexpected' &&
    kind !== 'overstep' &&
    kind !== 'refusal' &&
    kind !== 'uncommitted'
  ) {
    return undefined
  }

  return {
    kind,
    activities: strings(payload.activities),
    activityRunIds: strings(payload.activity_run_ids),
    stage: text(payload.stage),
    paths: strings(payload.paths),
    note: text(payload.note),
  }
}

export const warningsIn = (
  events: readonly EventRow[],
): readonly TTreeWarning[] =>
  events.flatMap((event) => {
    const warning = parse(event)

    return warning === undefined ? [] : [warning]
  })

/**
 * The warnings belonging to one Activity Run.
 *
 * Matched on the ids the warning carries rather than on the event's own
 * activity_run_id, because a concurrent Stage raises ONE warning for several
 * Activity Runs and every one of them is entitled to show it.
 */
export const warningsFor = (
  events: readonly EventRow[],
  activityRunId: string,
): readonly TTreeWarning[] =>
  warningsIn(events).filter((warning) =>
    warning.activityRunIds.includes(activityRunId),
  )

/** The sentence under a group of paths, which is the whole point of the kind. */
export const warningExplanation = (kind: TWarningKind): string =>
  kind === 'unexpected'
    ? 'These files changed while the Activity ran and it did not report ' +
      "them. They may be the Activity's work, or yours — pi-crust cannot " +
      'tell. Nothing was changed back.'
    : kind === 'overstep'
      ? 'This Activity changed paths outside what it declared it writes. ' +
        'Nothing was changed back — the tree is yours to settle.'
      : kind === 'refusal'
        ? 'The path policy governed these tool calls. A blocked call never ran.'
        : 'The work is in the working tree. Nothing was staged back, unstaged, ' +
          "or signed on anybody's behalf — commit it yourself when you are ready."

export const warningTitle = (kind: TWarningKind): string =>
  kind === 'unexpected'
    ? 'unexplained changes'
    : kind === 'overstep'
      ? 'changes outside what was declared'
      : kind === 'refusal'
        ? 'refused by the path policy'
        : 'commit(s) this run could not make'
