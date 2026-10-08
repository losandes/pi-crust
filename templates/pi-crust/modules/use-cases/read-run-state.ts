/**
 * Where did this run get to? One function, two callers.
 *
 * The reporter prints what this returns and `--resume` skips what it says is
 * done, so the two cannot disagree about a phase's fate — there is one answer
 * and both read it.
 *
 * Two rules decide correctness:
 *
 *   1. The LATEST record per phase name wins. A joined session can run `build`
 *      twice; if the second one failed, `build` is not complete.
 *   2. `resume_from` is undefined only when every phase succeeded. Nothing to
 *      resume is a different answer from "start at the beginning".
 */

import type {
  TTraceEventRow,
  TTraceGateRow,
  TTracePhaseRow,
  TTraceRows,
} from '../data/trace-reader'
import { readTrace } from '../data/trace-reader'
import type { TGateCheck } from '../typedefs/gate'
import type {
  TEnvelopeRecord,
  TGateOutcome,
  TPhaseLog,
  TPhaseState,
  TRunState,
} from '../typedefs/run-state'
import { safeParseSettlement, settledOr } from '../typedefs/settlement'
import type { TEventPayload } from '../typedefs/trace'

const asObject = (json: string | null): Readonly<Record<string, unknown>> =>
  settledOr(
    safeParseSettlement(
      () => JSON.parse(json ?? '{}') as Readonly<Record<string, unknown>>,
    ),
    {},
  )

const asArray = <TItem>(json: string | null): readonly TItem[] => {
  const parsed = settledOr<unknown>(
    safeParseSettlement<unknown>(() => JSON.parse(json ?? '[]')),
    [],
  )
  return Array.isArray(parsed) ? (parsed as TItem[]) : []
}

const gateOutcome = (row: TTraceGateRow, phaseName: string): TGateOutcome => ({
  gate: row.gate,
  phase: phaseName,
  attempt: row.attempt,
  passed: row.passed === 1,
  violations: asArray<string>(row.violations_json),
  checks: asArray<TGateCheck>(row.checks_json),
})

const logsFor = (
  events: readonly TTraceEventRow[],
  phaseId: string,
): readonly TPhaseLog[] =>
  events
    .filter((event) => event.phase_id === phaseId && event.type === 'log')
    .map((event) => ({
      name: event.name,
      payload: asObject(event.payload_json),
    }))

const phaseState = (row: TTracePhaseRow, rows: TTraceRows): TPhaseState => ({
  seq: row.seq,
  phase_id: row.phase_id,
  name: row.name,
  kind: row.kind,
  owner: row.owner,
  description: row.description ?? '',
  status: row.status,
  attempt: row.attempt ?? 0,
  error: row.error ?? undefined,
  started_at: row.started_at ?? undefined,
  ended_at: row.ended_at ?? undefined,
  gates: rows.gates
    .filter((gate) => gate.phase_id === row.phase_id)
    .map((gate) => gateOutcome(gate, row.name)),
  logs: logsFor(rows.events, row.phase_id),
})

/** The latest record per phase NAME — a re-run phase overrides its predecessor. */
export const latestByName = (
  phases: readonly TPhaseState[],
): readonly TPhaseState[] =>
  phases.filter(
    (phase) =>
      !phases.some(
        (other) => other.name === phase.name && other.seq > phase.seq,
      ),
  )

const envelopeRecords = (
  rows: TTraceRows,
  phaseName: (phaseId: string | null) => string,
): readonly TEnvelopeRecord[] =>
  rows.envelopes.map((row) => ({
    phase: phaseName(row.phase_id),
    agent: row.agent,
    output_type: row.output_type,
    valid: row.valid === 1,
    attempt: row.attempt,
    payload: asObject(row.payload_json),
  }))

export const readRunState = (
  dbPath: string,
  runId?: string,
): TRunState | undefined => {
  const rows = readTrace(dbPath, runId)
  if (rows === undefined) {
    return undefined
  }
  const phases = rows.phases.map((row) => phaseState(row, rows))
  const latest = latestByName(phases)
  const completed = latest
    .filter((phase) => phase.status === 'success')
    .map((phase) => phase.name)
  const unfinished = latest.filter((phase) => phase.status !== 'success')
  const names = new Map(
    rows.phases.map((row) => [row.phase_id, row.name] as const),
  )
  return {
    run_id: rows.session.run_id,
    lifecycle: rows.session.lifecycle ?? '',
    request: rows.session.request ?? '',
    status: rows.session.status ?? '',
    engineer: rows.session.engineer ?? '',
    started_at: rows.session.started_at ?? undefined,
    ended_at: rows.session.ended_at ?? undefined,
    tokens: rows.session.total_tokens ?? 0,
    cost: rows.session.total_cost ?? 0,
    phases,
    completed,
    // A phase that is RUNNING is not a phase to resume from: acting on that
    // line would start a second agent against a live session, both writing
    // the same trace. Only a stopped run has somewhere to be picked up.
    resume_from: unfinished.find((phase) => phase.status !== 'running')?.name,
    failed_gates: phases
      .flatMap((phase) => phase.gates)
      .filter((gate) => !gate.passed)
      .toReversed(),
    envelopes: envelopeRecords(rows, (phaseId) =>
      phaseId === null ? '' : (names.get(phaseId) ?? ''),
    ),
  }
}

/**
 * The payload a code phase filed under `eventName` — how a code step replays.
 *
 * A code phase's verdict is NOT its phase status: a verify phase that ran the
 * suite did its job even when the suite came back red. Replay therefore reads
 * what the phase recorded, never what its status implies.
 */
export const latestLogPayload = (
  state: TRunState,
  phaseName: string,
  eventName: string,
): TEventPayload | undefined =>
  latestByName(state.phases)
    .find((candidate) => candidate.name === phaseName)
    ?.logs.findLast((log) => log.name === eventName)?.payload
