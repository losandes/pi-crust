/**
 * Traced events, and the shape of the tracer every layer writes through.
 */

import type { TAgentConfig } from './config'
import type { TGateReport } from './gate'
import type { TPhase } from './phase'

export type TEventPayload = Readonly<Record<string, unknown>>

/** One traced event, always logged against run_id + phase. */
export type TEventRecord = Readonly<{
  run_id: string
  phase_id: string
  /**
   * phase_start | agent_start | tool_call | handoff | gate_pass | gate_fail |
   * log | agent_end | phase_end | error
   */
  type: string
  name: string
  payload: TEventPayload
  parent_id: string
  tokens: number | undefined
  // Spans: set both when an event covers real elapsed time (a tool call), so
  // the UI lays it out on a time axis without parsing payload JSON. Left unset,
  // the tracer stamps started_at with the moment the event was recorded.
  started_at: string | undefined
  ended_at: string | undefined
}>

/** Everything optional on an event, so a caller writes only what it knows. */
export type TEventInput = Readonly<{
  run_id: string
  phase_id?: string
  type: string
  name?: string
  payload?: TEventPayload
  parent_id?: string
  tokens?: number
  started_at?: string
  ended_at?: string
}>

/**
 * The tracer's surface. Files are the raw record; the SQLite db is the
 * queryable mirror the UI polls. Both are written as it happens.
 */
export type TTracer = Readonly<{
  dbPath: string
  event: (input: TEventInput) => string
  sessionStart: (runId: string, engineer: string, lifecycleName: string) => void
  /** The working tree and branch a run is executing in. */
  sessionWorkspace: (
    runId: string,
    workspaceRoot: string,
    branch: string,
  ) => void
  sessionRequest: (runId: string, request: string) => void
  sessionWaiting: (runId: string) => void
  sessionFinish: (runId: string, ok: boolean) => void
  sessionAddUsage: (runId: string, tokens: number, cost: number) => void
  processStart: (
    runId: string,
    kind: string,
    name: string,
    pid: number,
    command: string,
  ) => void
  processEnd: (runId: string, pid: number) => void
  processesEndAll: (runId: string) => void
  maxPhaseSeq: (runId: string) => number
  /**
   * The payloads of every event of one name, in order.
   *
   * Reading the trace back rather than accumulating in memory: the events are
   * written as they happen, so a report built from them cannot drift from
   * what was recorded, and a run that died half way still has its record.
   */
  eventsNamed: (
    runId: string,
    name: string,
  ) => readonly Readonly<Record<string, unknown>>[]
  phaseUpsert: (phase: TPhase) => void
  envelopeRow: (
    phase: TPhase,
    agent: string,
    outputType: string,
    payloadJson: string,
    valid: boolean,
    attempt: number,
  ) => void
  gateRow: (
    phase: TPhase,
    gate: string,
    report: TGateReport,
    attempt: number,
  ) => void
  agentSessionRow: (
    runId: string,
    agent: TAgentConfig,
    sessionId: string,
    contextTokens: number,
    contextWindow: number,
  ) => void
  close: () => void
}>
