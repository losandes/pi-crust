/**
 * The documents a run produced, from the two sources that know about them.
 *
 * Neither source is sufficient alone, and they disagree in opposite
 * directions:
 *
 * - an envelope's `artifacts` is SELF-REPORTED. It is the only way to learn
 *   about a file written outside the handoff directory, and it carries the
 *   agent's own summary of what the file says — but nothing checks it, so it
 *   can name a file that was never written.
 * - the handoff directory is OBSERVED. It cannot be wrong about existence,
 *   and it sees files no agent claimed, including the ones the system wrote
 *   rather than an agent — but it knows nothing about meaning.
 *
 * So the envelope is the authority on meaning and the disk is the authority
 * on existence, and a document is listed when either knows about it. A
 * claimed file that is not there is still listed, as missing: that is a
 * defect in the run and hiding it would be the one thing worse than showing
 * it.
 */
import { safeParseSettlement, settledOr } from '@typedefs'
import type { EventRow } from '@/domains/events'
import type { Envelope, HandoffFile } from '../typedefs/handoff'

/** Where a document came from, which decides how much a card can say. */
export type TArtifactSource =
  /** An agent reported it and it exists. */
  | 'reported'
  /** Found in the handoff directory, claimed by nobody. */
  | 'observed'
  /** An agent reported it and it is not there. */
  | 'missing'
  /** Written by the run itself: the gate question, the answer to it. */
  | 'system'

export type TArtifact = Readonly<{
  /** Path relative to the session directory — what a reader recognises. */
  path: string
  /** The file's own name, for the card's title when nothing better exists. */
  name: string
  /**
   * The document's own first heading.
   *
   * A real title a reader recognises, rather than a filename — and it comes
   * from the document, so it cannot drift from what the document says.
   * Empty when the file has no heading, or when only a claim is known.
   */
  title: string
  source: TArtifactSource
  /** The activityRun that produced it, when known. */
  activityRunId: string | undefined
  /** The agent that produced it, when known. */
  agent: string | undefined
  /** The agent's account of what this document concludes. Empty when unknown. */
  summary: string
  /** What the next activity is expected to take from it. Empty when unknown. */
  notes: string
}>

/**
 * Files the run writes for its own machinery rather than as a activity's output.
 *
 * Listed, because a reader should not have to know which files the interface
 * has special-cased — but quietly, because they are already rendered in the
 * gate pane and are not what anybody means by "what did this activity produce".
 */
const SYSTEM_FILES = /^(decision-request|decision-answer|answers-.*)\.md$/

/** `…/sessions/<run>/context_handoff/design.md` → `context_handoff/design.md`. */
export const relativeToSession = (
  path: string,
  runId: string,
  /**
   * This run's handoff directory, resolved absolute by the server. When
   * `--handoff` relocated it outside `sessions/<run>/`, a path under THIS
   * directory collapses onto the same `context_handoff/<relative>` key the
   * observed listing already uses — otherwise the same document would
   * render as two cards, one reported and one observed.
   */
  handoffDir?: string,
): string => {
  const marker = `/sessions/${runId}/`
  const at = path.indexOf(marker)
  if (at !== -1) {
    return path.slice(at + marker.length)
  }
  if (handoffDir !== undefined && handoffDir !== '') {
    const root = handoffDir.endsWith('/') ? handoffDir : `${handoffDir}/`
    if (path.startsWith(root)) {
      return `context_handoff/${path.slice(root.length)}`
    }
  }
  return path
}

const nameOf = (path: string): string => path.split('/').at(-1) ?? path

type TPayload = Readonly<{
  artifacts?: unknown
  summary?: unknown
  notes_for_next_agent?: unknown
}>

const payloadOf = (envelope: Envelope): TPayload =>
  settledOr<TPayload>(
    safeParseSettlement(
      () => JSON.parse(envelope.payload_json ?? '{}') as TPayload,
    ),
    {},
  )

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * What each activityRun was observed to write, newest observation per activityRun.
 *
 * Only `created` counts as a activity-run's output. A `modified` entry means the
 * activityRun changed a document another activityRun owns, which is a different claim
 * entirely and belongs in the violation report rather than in a list of
 * outputs.
 */
export const observedByActivityRun = (
  events: readonly EventRow[],
): ReadonlyMap<string, readonly string[]> => {
  const claims = events.flatMap((event) => {
    if (event.type !== 'artifacts' || event.activity_run_id === null) return []
    const activityRunId = event.activity_run_id
    const payload = safeParseSettlement(
      () => JSON.parse(event.payload_json ?? '{}') as { created?: unknown },
    )
    // An unreadable claim contributes nothing, and the activityRun keeps
    // whatever an earlier event said about it.
    return payload.status === 'ok'
      ? [[activityRunId, strings(payload.data.created)] as const]
      : []
  })
  // Newest observation per activityRun: a later entry replaces an earlier one,
  // which is what the repeated `set` did.
  return new Map<string, readonly string[]>(claims)
}

/**
 * Every document this run produced, in the order a reader meets them.
 *
 * `present` is the directory listing; it is what turns a claim into either a
 * document or a defect. When nothing is known about the directory it is left
 * undefined, and no claim is called missing on the strength of a listing that
 * was never taken.
 */
/**
 * The first entry claiming each path, in the order the claims arrived.
 *
 * A reported artifact and the file on disk are the same document, and the
 * reported one is kept because it is the one that can say what it means.
 */
const firstByPath = (entries: readonly TArtifact[]): readonly TArtifact[] => {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.path)) return false
    seen.add(entry.path)
    return true
  })
}

export const runArtifacts = (params: {
  runId: string
  /** This run's handoff directory, resolved absolute by the server. */
  handoffDir?: string
  envelopes: readonly Envelope[]
  events: readonly EventRow[]
  present: readonly HandoffFile[] | undefined
}): readonly TArtifact[] => {
  const onDisk =
    params.present === undefined
      ? undefined
      : new Map(params.present.map((file) => [file.path, file]))

  // Reported first: these are the ones that can say what they mean.
  const reported = params.envelopes
    .filter((envelope) => envelope.valid === 1)
    .flatMap((envelope) => {
      const payload = payloadOf(envelope)
      return strings(payload.artifacts).map((raw) => {
        const path = relativeToSession(raw, params.runId, params.handoffDir)
        return {
          path,
          name: nameOf(path),
          title: onDisk?.get(path)?.title ?? '',
          source:
            onDisk === undefined || onDisk.has(path) ? 'reported' : 'missing',
          activityRunId: envelope.activity_run_id ?? undefined,
          agent: envelope.agent ?? undefined,
          summary: text(payload.summary),
          notes: text(payload.notes_for_next_agent),
        } satisfies TArtifact
      })
    })

  // Then whatever is on disk that nobody claimed. Over-reporting here is
  // deliberate: a document a activity forgot to report is still a document
  // somebody would otherwise have to go hunting for.
  const observed = observedByActivityRun(params.events)
  const unclaimed = (params.present ?? []).map((file) => {
    const owner = [...observed.entries()].find(([, created]) =>
      created.includes(nameOf(file.path)),
    )
    return {
      path: file.path,
      name: nameOf(file.path),
      title: file.title,
      source: SYSTEM_FILES.test(nameOf(file.path)) ? 'system' : 'observed',
      activityRunId: owner?.[0],
      agent: undefined,
      summary: '',
      notes: '',
    } satisfies TArtifact
  })

  return firstByPath([...reported, ...unclaimed])
}

/** The same list, narrowed to one activityRun — what this activity produced. */
export const activityRunArtifacts = (
  all: readonly TArtifact[],
  activityRunId: string,
): readonly TArtifact[] =>
  all.filter((entry) => entry.activityRunId === activityRunId)

/**
 * A activityRun that changed or removed a document belonging to another activityRun.
 *
 * Nothing forbids this today, which is why it is worth showing: the handoff
 * directory is granted to every agent wholesale, and being gitignored it is
 * invisible to the permission check that would otherwise catch it.
 */
export type TArtifactViolation = Readonly<{
  activityRunId: string
  modified: readonly string[]
  deleted: readonly string[]
}>

export const artifactViolations = (
  events: readonly EventRow[],
): readonly TArtifactViolation[] =>
  events.flatMap((event) => {
    if (event.type !== 'artifacts' || event.activity_run_id === null) return []
    const activityRunId = event.activity_run_id
    const payload = settledOr<{ modified?: unknown; deleted?: unknown }>(
      safeParseSettlement(
        () =>
          JSON.parse(event.payload_json ?? '{}') as {
            modified?: unknown
            deleted?: unknown
          },
      ),
      {},
    )
    const modified = strings(payload.modified)
    const deleted = strings(payload.deleted)
    return modified.length + deleted.length === 0
      ? []
      : [{ activityRunId, modified, deleted }]
  })
