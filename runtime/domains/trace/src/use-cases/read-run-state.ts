/**
 * Where did this run get to? One function, two callers.
 *
 * The reporter prints what this returns and `--resume` skips what it says is
 * done, so the two cannot disagree about an activity run's fate — there is one answer
 * and both read it.
 *
 * Two rules decide correctness:
 *
 *   1. The LATEST record per activityRun name wins. A joined session can run `build`
 *      twice; if the second one failed, `build` is not complete.
 *   2. `resume_from` is undefined when every RECORDED activity run succeeded,
 *      not necessarily when the run is finished: a session that died between
 *      Activities has no row for the ones it never reached, so this alone
 *      cannot say there is nothing left. `resumable` answers that question
 *      instead, from the session's own status.
 */

import {
  safeParseSettlement,
  settledOr,
} from '../../../../../lib/typedefs/src/settlement'
import type {
  TActivityRunLog,
  TActivityRunState,
  TEnvelopeRecord,
  TEventPayload,
  TGateCheck,
  TGateOutcome,
  TRunState,
  TTreeWarning,
} from '../../../../lib/contracts'
import { WARNING_EVENT, warningFromPayload } from '../../../../lib/contracts'
import type {
  TTraceActivityRunRow,
  TTraceEventRow,
  TTraceGateRow,
  TTraceRows,
} from '../data/trace-reader'
import { readTrace } from '../data/trace-reader'

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

const gateOutcome = (
  row: TTraceGateRow,
  activityRunName: string,
): TGateOutcome => ({
  gate: row.gate,
  activityRun: activityRunName,
  passed: row.passed === 1,
  violations: asArray<string>(row.violations_json),
  checks: asArray<TGateCheck>(row.checks_json),
})

const logsFor = (
  events: readonly TTraceEventRow[],
  activityRunId: string,
): readonly TActivityRunLog[] =>
  events
    .filter(
      (event) =>
        event.activity_run_id === activityRunId && event.type === 'log',
    )
    .map((event) => ({
      name: event.name,
      payload: asObject(event.payload_json),
    }))

const activityRunState = (
  row: TTraceActivityRunRow,
  rows: TTraceRows,
): TActivityRunState => ({
  seq: row.seq,
  activity_run_id: row.activity_run_id,
  name: row.name,
  kind: row.kind,
  owner: row.owner,
  description: row.description ?? '',
  status: row.status,
  error: row.error ?? undefined,
  started_at: row.started_at ?? undefined,
  ended_at: row.ended_at ?? undefined,
  gates: rows.gates
    .filter((gate) => gate.activity_run_id === row.activity_run_id)
    .map((gate) => gateOutcome(gate, row.name)),
  logs: logsFor(rows.events, row.activity_run_id),
})

/** The latest record per activityRun NAME — a re-run activityRun overrides its predecessor. */
export const latestByName = (
  activityRuns: readonly TActivityRunState[],
): readonly TActivityRunState[] =>
  activityRuns.filter(
    (activityRun) =>
      !activityRuns.some(
        (other) =>
          other.name === activityRun.name && other.seq > activityRun.seq,
      ),
  )

/**
 * Every warning the run filed, in the order it filed them.
 *
 * From the events rather than recomputed: the comparison that raises a
 * warning needs three sets that only existed while the Activity Run was
 * happening, and a reporter that tried to rebuild it later would be reading a
 * tree that has moved on since.
 */
const warningsIn = (rows: TTraceRows): readonly TTreeWarning[] =>
  rows.events
    .filter((event) => event.type === 'log' && event.name === WARNING_EVENT)
    .flatMap((event) => {
      const warning = warningFromPayload(asObject(event.payload_json))

      return warning === undefined ? [] : [warning]
    })

const envelopeRecords = (
  rows: TTraceRows,
  activityRunName: (activityRunId: string | null) => string,
): readonly TEnvelopeRecord[] =>
  rows.envelopes.map((row) => ({
    activityRun: activityRunName(row.activity_run_id),
    agent: row.agent,
    output_type: row.output_type,
    valid: row.valid === 1,
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
  const activityRuns = rows.activityRuns.map((row) =>
    activityRunState(row, rows),
  )
  const latest = latestByName(activityRuns)
  const completed = latest
    .filter((activityRun) => activityRun.status === 'success')
    .map((activityRun) => activityRun.name)
  const unfinished = latest.filter(
    (activityRun) => activityRun.status !== 'success',
  )
  const names = new Map(
    rows.activityRuns.map((row) => [row.activity_run_id, row.name] as const),
  )
  return {
    run_id: rows.session.run_id,
    lifecycle: rows.session.lifecycle ?? '',
    name: rows.session.name ?? '',
    request: rows.session.request ?? '',
    status: rows.session.status ?? '',
    engineer: rows.session.engineer ?? '',
    started_at: rows.session.started_at ?? undefined,
    ended_at: rows.session.ended_at ?? undefined,
    tokens: rows.session.total_tokens ?? 0,
    cost: rows.session.total_cost ?? 0,
    activityRuns,
    completed,
    // A activityRun that is RUNNING is not an activity run to resume from: acting on that
    // line would start a second agent against a live session, both writing
    // the same trace. Only a stopped run has somewhere to be picked up.
    resume_from: unfinished.find(
      (activityRun) => activityRun.status !== 'running',
    )?.name,
    resumable: rows.session.status !== 'success',
    failed_gates: activityRuns
      .flatMap((activityRun) => activityRun.gates)
      .filter((gate) => !gate.passed)
      .toReversed(),
    warnings: warningsIn(rows),
    envelopes: envelopeRecords(rows, (activityRunId) =>
      activityRunId === null ? '' : (names.get(activityRunId) ?? ''),
    ),
  }
}

/**
 * The payload a code activityRun filed under `eventName` — how a code activity replays.
 *
 * A code activity-run's verdict is NOT its activityRun status: a verify activityRun that ran the
 * suite did its job even when the suite came back red. Replay therefore reads
 * what the activityRun recorded, never what its status implies.
 */
export const latestLogPayload = (
  state: TRunState,
  activityRunName: string,
  eventName: string,
): TEventPayload | undefined =>
  latestByName(state.activityRuns)
    .find((candidate) => candidate.name === activityRunName)
    ?.logs.findLast((log) => log.name === eventName)?.payload
