/**
 * Gates and agent calls — what a claim must survive before it is believed.
 */

import type { TUpstream } from './step'
import type { TEnvelopeBase, TEnvelopeSpec } from './envelope'
import type { TRun } from './run'

/**
 * One thing a gate looked at, and what it found.
 *
 * `note` is the evidence — "exists, 2.1KB", "exit 0", "not in the diff". On a
 * failed check it doubles as the reason, so it is what the agent is told.
 */
export type TGateCheck = Readonly<{
  /** what was checked: a path, a command, a test */
  item: string
  ok: boolean
  note: string
}>

/** What every gate returns: the checks it ran. Violations are derived. */
export type TGateReport = Readonly<{
  checks: readonly TGateCheck[]
}>

/** The empty report every gate starts from. */
export const emptyReport: TGateReport = { checks: [] }

/** Append one check. Pure: the report is rebuilt, never mutated. */
export const addCheck = (
  report: TGateReport,
  item: string,
  ok: boolean,
  note = '',
): TGateReport => ({ checks: [...report.checks, { item, ok, note }] })

export const violationsOf = (report: TGateReport): readonly string[] =>
  report.checks
    .filter((check) => !check.ok)
    .map((check) => `${check.item}: ${check.note || 'failed'}`)

export const reportPassed = (report: TGateReport): boolean =>
  violationsOf(report).length === 0

/**
 * A gate: `gate(envelope, run) -> TGateReport`.
 *
 * `name` is carried on the record rather than read off the function, because
 * the db stores it and a minified or wrapped function has no useful name.
 */
export type TGate = Readonly<{
  name: string
  check: (envelope: TEnvelopeBase, run: TRun) => TGateReport
}>

/** One agent invocation: prompt in, typed envelope out, gates verified. */
export type TAgentCall<TEnvelope extends TEnvelopeBase = TEnvelopeBase> =
  Readonly<{
    outputType: TEnvelopeSpec<TEnvelope>
    prompt: string
    previous?: TEnvelopeBase
    /**
     * Every Activity the preceding Unit produced, named.
     *
     * `previous` is one of these. A concurrent Stage produces several, and an
     * agent shown only the first would be judging half the work its
     * predecessors did — so the prompt renders all of them, with the Activity
     * that produced each.
     */
    upstream?: readonly TUpstream[]
    gates?: readonly TGate[]
    /**
     * The paths this call is about, for `routing.skills`.
     *
     * Omitted, the working tree's uncommitted paths are used. A reviewer that
     * runs after a commit must pass the set explicitly, or it would route
     * against an empty change and load nothing.
     */
    changedPaths?: readonly string[]
    /**
     * The ref or range this call is about, for the agent's own reading.
     *
     * Omitted, the agent is judging the working tree. Given, the work may be
     * committed and absent from it, so the prompt tells the agent to read the
     * range instead.
     */
    changeBase?: string
  }>
