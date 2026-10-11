/**
 * What a activityRun's events say, parsed once and testably.
 *
 * All of this was inline in the detail component, where a malformed payload
 * could only be reasoned about by reading JSX. Every function here answers one
 * question about a activityRun and tolerates the shapes older runs actually wrote —
 * which is the part worth testing.
 */

import { parseToolCall } from './events'
import { ts } from './format'
import type {
  AgentEndPayload,
  EventRow,
  GateCheck,
  GateResult,
  ActivityRun,
} from './types'

export type TUsageRow = Readonly<{
  label: string
  tokens: number
  cost: number
  /** Total gets a rule above it; reasoning is indented under output. */
  kind?: 'total' | 'nested'
  title?: string
}>

export type TActivityRunUsage = Readonly<{
  rows: readonly TUsageRow[]
  /** The run predates the per-component breakdown; only a total was recorded. */
  partial: boolean
}>

/**
 * What this activity-run's agent run spent, off its `agent_end` event.
 *
 * Undefined for non-agent activityRuns and for a run still in flight. Older runs
 * recorded only a lump cost, so the breakdown is optional and rows are built
 * from whatever was written.
 */
export const activityRunUsage = (
  activityRun: ActivityRun,
  events: readonly EventRow[],
): TActivityRunUsage | undefined => {
  if (activityRun.kind !== 'agent') return undefined
  const end = events.find((event) => event.type === 'agent_end')
  if (end === undefined) return undefined

  let payload: AgentEndPayload = {}
  try {
    payload = JSON.parse(end.payload_json ?? '{}') as AgentEndPayload
  } catch {
    // A malformed payload is a missing panel, never a broken detail view.
  }

  const usage = payload.usage
  if (!usage) {
    // Pre-breakdown run: the event's own token count and the lump cost hold.
    return {
      partial: true,
      rows: [
        {
          label: 'total',
          tokens: end.tokens ?? 0,
          cost: payload.cost ?? 0,
          kind: 'total',
        },
      ],
    }
  }

  const thinking: readonly TUsageRow[] = usage.reasoning_tokens
    ? [
        {
          label: 'thinking',
          tokens: usage.reasoning_tokens,
          /*
           * Thinking bills at the output rate, so its share of the output cost
           * is exact arithmetic — but it is already INSIDE the output row.
           */
          cost: usage.output_tokens
            ? (usage.output_cost * usage.reasoning_tokens) / usage.output_tokens
            : 0,
          kind: 'nested',
          title:
            'Thinking tokens — part of output above, billed at the output rate. ' +
            'Not added to the total.',
        },
      ]
    : []

  return {
    partial: false,
    rows: [
      { label: 'input', tokens: usage.input_tokens, cost: usage.input_cost },
      { label: 'output', tokens: usage.output_tokens, cost: usage.output_cost },
      ...thinking,
      {
        label: 'cache read',
        tokens: usage.cache_read_tokens,
        cost: usage.cache_read_cost,
      },
      {
        label: 'cache write',
        tokens: usage.cache_write_tokens,
        cost: usage.cache_write_cost,
      },
      {
        label: 'total',
        tokens: usage.total_tokens,
        cost: usage.total_cost,
        kind: 'total',
      },
    ],
  }
}

/** Per-component costs run to fractions of a cent; four places keeps them real. */
export const money = (amount: number): string => {
  if (!amount) return '$0'
  return amount < 0.0001 ? '<$0.0001' : `$${amount.toFixed(4)}`
}

/**
 * The engineer's incoming ask, logged by every lifecycle's request activityRun as a `log`
 * event with an `input` payload.
 */
export const requestText = (
  activityRun: ActivityRun,
  events: readonly EventRow[],
): string | undefined => {
  if (activityRun.kind !== 'engineer') return undefined
  for (const event of events) {
    if (event.type !== 'log' || !event.payload_json) continue
    try {
      const parsed: unknown = JSON.parse(event.payload_json)
      if (parsed && typeof parsed === 'object' && 'input' in parsed) {
        const input = (parsed as { input?: unknown }).input
        if (typeof input === 'string' && input.trim()) return input
      }
    } catch {
      /* not JSON — skip */
    }
  }
  return undefined
}

export const violations = (gate: GateResult): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(gate.violations_json ?? '[]')
    if (Array.isArray(parsed)) {
      return parsed.map((item) =>
        typeof item === 'string' ? item : JSON.stringify(item),
      )
    }
  } catch {
    /* keep the raw text below */
  }
  return gate.violations_json ? [gate.violations_json] : []
}

/**
 * Per-item gate evidence.
 *
 * Undefined means no evidence was recorded — a legacy row, rendered as a plain
 * line. An empty array means the gate ran and inspected nothing, which is a
 * real and different answer, and the UI says so in words.
 */
export const gateChecks = (gate: GateResult): readonly GateCheck[] | undefined => {
  const raw = gate.checks_json
  if (raw === null || raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    return parsed
      .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
      .map((c) => ({
        item: typeof c.item === 'string' ? c.item : '',
        ok: c.ok === true,
        note: typeof c.note === 'string' ? c.note : '',
      }))
  } catch {
    return undefined
  }
}

/** Collapsed-row count label: mixed gates surface how many items failed. */
export const checksLabel = (checks: readonly GateCheck[]): string => {
  const failed = checks.filter((check) => !check.ok).length
  return failed > 0 ? `${failed} of ${checks.length} failed` : String(checks.length)
}

export const eventDurationMs = (event: EventRow): number => {
  const started = ts(event.started_at)
  const ended = ts(event.ended_at)
  if (Number.isFinite(started) && Number.isFinite(ended)) return ended - started
  /*
   * tool_call rows on older tracers have no ended_at — the payload's
   * duration_ms (when the coding agent reported one) is the source of truth.
   */
  if (event.type === 'tool_call') {
    const call = parseToolCall(event)
    if (call?.duration_ms != null) return call.duration_ms
  }
  return Number.NaN
}
