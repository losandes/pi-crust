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
 * The signature widened when the repository's checks became a gate. Every
 * other gate ignores the rest; `checks` runs commands, and a command needs
 * to know which repository and which paths it is being run about. One
 * signature, because two kinds of gate would mean two registries and two
 * places to declare one.
 */
export type TGate = Readonly<{
  name: string
  check: (
    envelope: TEnvelopeBase,
    run: TRun,
    changedPaths: readonly string[],
  ) => TGateReport
  /**
   * Whether this gate may only be judged once nothing else is writing.
   *
   * The distinction is NOT "touches the filesystem". Four gates do and are
   * still safe mid-Stage: `artifactsExist`, `filesNonEmpty`, `jsonParses`
   * and `diffMatchesClaims` stat and read only the paths the envelope itself
   * named, so they are predicates over an envelope AND the files it declares.
   * A sibling cannot be writing those, because a concurrent Stage is refused
   * at load unless its Activities' declared paths are disjoint.
   *
   * The line is whether the gate's SCOPE comes from the envelope or from the
   * tree. `checks` derives its paths by scanning what changed, so a sibling
   * mid-write changes the question it is answering; it waits for the Stage
   * boundary.
   *
   * That safety is bought by the disjointness check, not by these gates being
   * pure. Relax disjointness and all four need this flag.
   */
  readsTree?: boolean
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
