/**
 * The harness-owned parts of a pull request body: the issue link, the
 * `## Activities` record of what the whole run found, and the `## Checks`
 * task list computed from recorded gate outcomes.
 *
 * Every function here is pure: a facts record in, markdown out. `deliver`
 * (`gh-pull-request.ts`) assembles the record from `TRunState`, the config
 * and the working tree; nothing in this module reads a global, spawns a
 * process, or touches the filesystem. See issue #58 and
 * `specs/improve-pr-descriptions.md` for the requirements this satisfies.
 */

import type {
  TActivityRunState,
  TEnvelopeRecord,
  TGateOutcome,
  TRunState,
} from '../../../../lib/contracts'
import { latestByName } from '../../../trace'
/** Everything the renderers need, assembled by `deliver` and by the fallback. */
export type TBodyFacts = Readonly<{
  runId: string
  /** the Activity's prompt, one of two places an issue number may be named */
  prompt: string
  state: TRunState | undefined
  /** `routing.checks[].name` — declared checks, so one that never ran is unchecked */
  declaredChecks: readonly string[]
  /** uncommitted + untracked paths at delivery time */
  uncommitted: readonly string[]
  /** the terminal Activity's own name, excluded from `## Activities` */
  composedBy: string
}>

/** More than this many issues and no closing keyword is used (1.1.2). */
export const ISSUE_LINK_LIMIT = 3
/** Decisions, assumptions and questions are capped per Activity (1.3.5). */
export const MAX_LEDGER_ITEMS = 5

// ── issue linking (1.1) ──────────────────────────────────────────────────

const ISSUE_HASH = /#(\d+)/g
const ISSUE_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/g

const numbersFrom = (text: string): readonly number[] => [
  ...[...text.matchAll(ISSUE_HASH)].map((match) => Number(match[1])),
  ...[...text.matchAll(ISSUE_URL)].map((match) => Number(match[1])),
]

const issueNumberFromEnvelope = (
  envelope: TEnvelopeRecord,
): number | undefined => {
  const raw = envelope.payload.issue_number
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0
    ? raw
    : undefined
}

/** Issue numbers named by the run, ascending, deduplicated (1.1.3). */
export const issueRefs = (facts: TBodyFacts): readonly number[] => {
  const fromText = [
    ...numbersFrom(facts.prompt),
    ...numbersFrom(facts.state?.request ?? ''),
  ]
  const fromEnvelopes = (facts.state?.envelopes ?? []).flatMap((envelope) => {
    const found = issueNumberFromEnvelope(envelope)
    return found === undefined ? [] : [found]
  })
  const all = [...fromText, ...fromEnvelopes].filter((n) => n > 0)
  return [...new Set(all)].toSorted((a, b) => a - b)
}

/** '' | 'closes #54, closes #55' | 'Refs #1, #2, #3, #4' (1.1.1, 1.1.2). */
export const issueLine = (refs: readonly number[]): string => {
  if (refs.length === 0) {
    return ''
  }
  return refs.length <= ISSUE_LINK_LIMIT
    ? refs.map((n) => `closes #${n}`).join(', ')
    : `Refs ${refs.map((n) => `#${n}`).join(', ')}`
}

const TITLE_LIMIT = 72

/** The title with its ` (#54)` suffix, never longer than 72 chars (1.1.4). */
export const titleWithIssues = (
  title: string,
  refs: readonly number[],
): string => {
  const eligible = refs.length > 0 && refs.length <= ISSUE_LINK_LIMIT
  const alreadyPresent = refs.every((n) => title.includes(`#${n}`))
  if (!eligible || alreadyPresent) {
    return title.slice(0, TITLE_LIMIT)
  }
  const suffix = ` (${refs.map((n) => `#${n}`).join(', ')})`
  if (suffix.length >= TITLE_LIMIT) {
    return title.slice(0, TITLE_LIMIT)
  }
  return title.length + suffix.length <= TITLE_LIMIT
    ? `${title}${suffix}`
    : `${title.slice(0, TITLE_LIMIT - suffix.length)}${suffix}`
}

/** A whole line that is the agent's own attempt at an issue link (1.1.5). */
const ISSUE_LINE_PATTERN =
  /^\s*(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?)\b.*#\d+.*$/i

// ── '## Activities' (1.3) ────────────────────────────────────────────────

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const stringField = (value: unknown, field: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const raw = value[field]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/** Every item in `payload[listField]` whose `[textField]` is a non-empty string. */
const listOfField = (
  payload: Readonly<Record<string, unknown>>,
  listField: string,
  textField: string,
): readonly string[] => {
  const raw = payload[listField]
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item: unknown) => {
    const text = stringField(item, textField)
    return text === undefined ? [] : [text]
  })
}

const ledgerGroup = (
  title: string,
  items: readonly string[],
): readonly string[] => {
  if (items.length === 0) {
    return []
  }
  const shown = items.slice(0, MAX_LEDGER_ITEMS)
  const rest = items.length - shown.length
  return [
    `- ${title}`,
    ...shown.map((text) => `  - ${text}`),
    ...(rest > 0 ? [`  - … and ${rest} more`] : []),
  ]
}

const gatesGroup = (gates: readonly TGateOutcome[]): readonly string[] =>
  gates.length === 0
    ? []
    : [
        '- Gates',
        ...gates.map(
          (gate) => `  - ${gate.gate}: ${gate.passed ? 'passed' : 'failed'}`,
        ),
      ]

/** The envelope for an Activity Run: last valid record, else last, else none (1.3.3). */
const envelopeFor = (
  state: TRunState | undefined,
  activityRunName: string,
): TEnvelopeRecord | undefined => {
  const records = (state?.envelopes ?? []).filter(
    (envelope) => envelope.activityRun === activityRunName,
  )
  const valid = records.filter((envelope) => envelope.valid)
  return valid.at(-1) ?? records.at(-1)
}

const activitySubsection = (
  activityRun: TActivityRunState,
  state: TRunState | undefined,
): string => {
  const envelope = envelopeFor(state, activityRun.name)
  const answer =
    envelope === undefined
      ? '(no envelope recorded)'
      : (stringField(envelope.payload, 'summary') ?? '(no summary recorded)')
  const payload = envelope?.payload ?? {}

  const lines = [
    `### ${activityRun.name}`,
    '',
    `- Answer: ${answer}`,
    `- Status: ${activityRun.status}`,
    ...ledgerGroup('Decisions', listOfField(payload, 'decisions', 'decision')),
    ...ledgerGroup(
      'Assumptions',
      listOfField(payload, 'assumptions', 'assumption'),
    ),
    ...ledgerGroup('Questions', listOfField(payload, 'unresolved', 'question')),
    ...gatesGroup(activityRun.gates),
  ]
  return lines.join('\n')
}

/** '## Activities' and its subsections, '' when there is nothing to render. */
export const activitiesSection = (facts: TBodyFacts): string => {
  const activityRuns = facts.state?.activityRuns ?? []
  const latest = latestByName(activityRuns)
    .filter((activityRun) => activityRun.name !== facts.composedBy)
    .toSorted((a, b) => a.seq - b.seq)
  if (latest.length === 0) {
    return ''
  }
  const subsections = latest.map((activityRun) =>
    activitySubsection(activityRun, facts.state),
  )
  return ['## Activities', '', subsections.join('\n\n')].join('\n')
}

// ── '## Checks' (1.4) ────────────────────────────────────────────────────

type TCheckRow = Readonly<{
  seq: number
  activityRun: string
  gate: string
  item: string
  ok: boolean
  note: string
}>

/** One row per recorded `TGateCheck`, plus one for a checkless failed gate (1.4.3). */
const collectChecks = (state: TRunState | undefined): readonly TCheckRow[] =>
  (state?.activityRuns ?? []).flatMap((activityRun) =>
    activityRun.gates.flatMap((gate): readonly TCheckRow[] => {
      if (gate.checks.length > 0) {
        return gate.checks.map((check) => ({
          seq: activityRun.seq,
          activityRun: activityRun.name,
          gate: gate.gate,
          item: check.item,
          ok: check.ok,
          note: check.note,
        }))
      }
      return gate.passed
        ? []
        : [
            {
              seq: activityRun.seq,
              activityRun: activityRun.name,
              gate: gate.gate,
              item: gate.gate,
              ok: false,
              note: gate.violations.join('; ') || 'failed',
            },
          ]
    }),
  )

/** Keep the highest-`seq` occurrence of each `(gate, item)`, ordered (1.4.2). */
const dedupChecks = (rows: readonly TCheckRow[]): readonly TCheckRow[] => {
  const byKey = new Map<string, TCheckRow>()
  for (const row of rows) {
    const key = `${row.gate}\u0000${row.item}`
    const existing = byKey.get(key)
    if (existing === undefined || row.seq > existing.seq) {
      byKey.set(key, row)
    }
  }
  return [...byKey.values()].toSorted(
    (a, b) =>
      a.seq - b.seq ||
      a.gate.localeCompare(b.gate) ||
      a.item.localeCompare(b.item),
  )
}

const NOTE_LIMIT = 200

/** First line only, whitespace-collapsed, truncated at 200 characters (1.4.2). */
const normaliseNote = (note: string): string => {
  const collapsed = (note.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim()
  return collapsed.length > NOTE_LIMIT
    ? `${collapsed.slice(0, NOTE_LIMIT)}…`
    : collapsed
}

const checkLine = (row: TCheckRow): string =>
  `- [${row.ok ? 'x' : ' '}] ${row.item} — ${normaliseNote(row.note)} (${row.gate} gate, ${row.activityRun})`

const UNCOMMITTED_SHOWN = 10

/** The working-tree line the section always ends with (1.4.5). */
const workingTreeLine = (uncommitted: readonly string[]): string => {
  const unique = [...new Set(uncommitted)].filter((path) => path !== '')
  if (unique.length === 0) {
    return '- [x] every change committed — nothing uncommitted or untracked'
  }
  const shown = unique.slice(0, UNCOMMITTED_SHOWN)
  const rest = unique.length - shown.length
  const names =
    rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ')
  return `- [ ] every change committed — ${unique.length} path(s) are not in this pull request: ${names}`
}

/** '## Checks' as a task list; never empty — the working-tree line always renders. */
export const checksSection = (facts: TBodyFacts): string => {
  const rows = collectChecks(facts.state)
  const deduped = dedupChecks(rows)
  const recordedItems = new Set(rows.map((row) => row.item))
  const missingDeclared = facts.declaredChecks
    .filter((name) => !recordedItems.has(name))
    .toSorted()
    .map(
      (name) =>
        `- [ ] ${name} — declared in routing.checks; no gate recorded it in this run`,
    )

  const lines = [
    ...deduped.map(checkLine),
    ...missingDeclared,
    workingTreeLine(facts.uncommitted),
  ]
  return ['## Checks', '', ...lines].join('\n')
}

// ── body assembly (1.5) ──────────────────────────────────────────────────

const TOP_HEADING = /^##\s+(.+?)\s*$/

/** Remove every top-level section whose heading text matches one of `names`. */
const removeSections = (body: string, names: readonly string[]): string => {
  const lines = body.split('\n')
  const headings = lines.flatMap((line, idx) => {
    const match = TOP_HEADING.exec(line)
    const title = match?.[1]
    return title === undefined
      ? []
      : [{ idx, title: title.trim().toLowerCase() }]
  })
  const doomed = new Set<number>()
  headings.forEach((heading, position) => {
    if (!names.includes(heading.title)) {
      return
    }
    const next = headings[position + 1]
    const end = next === undefined ? lines.length : next.idx
    for (let line = heading.idx; line < end; line += 1) {
      doomed.add(line)
    }
  })
  return lines.filter((_, idx) => !doomed.has(idx)).join('\n')
}

/** The agent's body, with issue lines and any '## Activities'/'## Checks' removed. */
export const agentProse = (body: string): string =>
  removeSections(body, ['activities', 'checks'])
    .split('\n')
    .filter((line) => !ISSUE_LINE_PATTERN.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const OUT_OF_SCOPE_HEADING = /^##\s+out of scope\s*$/i

/** Insert the harness sections before '## Out of scope', else append them (1.5.2). */
const withHarnessSections = (prose: string, harness: string): string => {
  if (harness === '') {
    return prose
  }
  const lines = prose.split('\n')
  const index = lines.findIndex((line) => OUT_OF_SCOPE_HEADING.test(line))
  if (index === -1) {
    return prose === '' ? harness : `${prose}\n\n${harness}`
  }
  const before = lines.slice(0, index).join('\n').replace(/\s+$/, '')
  const after = lines.slice(index).join('\n')
  return before === ''
    ? `${harness}\n\n${after}`
    : `${before}\n\n${harness}\n\n${after}`
}

/** The delivered body: issue line, agent prose, harness sections (1.5.1, 1.5.2). */
export const composedBody = (body: string, facts: TBodyFacts): string => {
  const issue = issueLine(issueRefs(facts))
  const prose = agentProse(body)
  const harness = [activitiesSection(facts), checksSection(facts)]
    .filter((section) => section !== '')
    .join('\n\n')
  const withSections = withHarnessSections(prose, harness)
  return [issue, withSections].filter((part) => part !== '').join('\n\n')
}
