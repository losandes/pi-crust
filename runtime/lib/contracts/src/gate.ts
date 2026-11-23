/**
 * Gates and agent calls — what a claim must survive before it is believed.
 */

import type { TEnvelopeBase, TEnvelopeSpec } from './envelope'
import type { TRun } from './run'
import type { TUpstream } from './runnable-activity'

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
 * A gate: `gate(envelope, run, changedPaths) -> TGateReport`.
 *
 * `name` is carried on the record rather than read off the function, because
 * the db stores it and a minified or wrapped function has no useful name.
 *
 * Output checks use the envelope and, where needed, the repository and
 * the paths observed for this Activity. Repository tasks are evaluated separately.
 */
export type TGate = Readonly<{
  name: string
  check: (
    envelope: TEnvelopeBase,
    run: TRun,
    changedPaths: readonly string[],
  ) => TGateReport
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
    /** agents running alongside this one, for attributing writes by path */
    cohort?: readonly string[]
    /**
     * What a gate said about this Activity's last attempt.
     *
     * Gates are judged by the driver now, not inside the call, because a
     * failed gate re-runs the Activity as its own Activity Run rather than
     * correcting it in place. The violations travel here so the second
     * attempt knows what the first got wrong.
     */
    feedback?: readonly string[]
    /** the review findings this call answers; [] outside a revise round */
    blockingFindings: readonly string[]
    /**
     * Whether this Activity is going to have its change committed.
     *
     * Enforcement needs it: a moved `HEAD` is a breach when the Activity was
     * not committing, and "was not committing" is the EFFECTIVE value —
     * under `--commit false` that includes Activities declaring `commit: true`.
     */
    committing?: boolean
    /**
     * The paths this call presents.
     * Judges receive the run's net change, committed or not, unless a named
     * scope overrides it. With no run change, use captured input paths when
     * present; otherwise omission selects the uncommitted working tree.
     */
    changedPaths?: readonly string[]
    /**
     * Where to read this change: the named scope, or the run's start commit
     * with a command that includes committed and uncommitted work. Omitted
     * when no run change remains, describing the uncommitted working tree.
     */
    changeBase?: string
  }>
