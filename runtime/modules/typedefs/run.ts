/**
 * The Run: config + run_id + agent map + tracer + console, bound once.
 *
 * Every mutable number a run accumulates lives in a closure inside
 * `use-cases/create-run.ts`, reached only through these functions — so no layer
 * mutates a record it was handed.
 */

import type { TPiCrustConfig } from './config'
import type { TEnvelopeBase } from './envelope'
import type { TActivityRun, TActivityRunStatus } from './activity-run'
import type { TTracer } from './trace'

/** One agent's coding-agent session, as recorded in `agent_map.json`. */
export type TAgentMapEntry = Readonly<{
  session_id: string
  model: string
  coding_agent: string
}>

/** The terminal narrative. Every line printed is also traced as a `log`. */
export type TConsole = Readonly<{
  /**
   * `workspaceRoot` and `vcsRoot` print together only when they differ --
   * the nested-workspace layout (1.5.1 of
   * specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md). Equal, the banner reads
   * exactly as it always has: neither root is an error, and a line that
   * fires on every run of a correct configuration teaches nobody to read it.
   */
  sessionStarted: (
    runId: string,
    engineer: string,
    workspaceRoot: string,
    vcsRoot: string,
  ) => void
  /**
   * The ask, exactly as this process received it, before anything is spent.
   *
   * Verbatim and ungrouped with `note`, which clips and collapses whitespace:
   * a prompt the shell truncated at an embedded quote, or substituted at a
   * backtick, is diagnosed by the characters themselves, and a reporter that
   * tidies them away reports the tidying instead of the damage.
   */
  promptReceived: (prompt: string) => void
  sessionFinished: (
    ok: boolean,
    tokens: number,
    cost: number,
    dbPath: string,
  ) => void
  activityRunStarted: (activityRun: TActivityRun) => void
  activityRunEnded: (activityRun: TActivityRun, seconds: number) => void
  note: (message: string) => void
  /**
   * Lines a person is meant to READ and COPY — never clipped, never reflowed.
   *
   * Separate from `note` because `note` trims and truncates, which is right
   * for a running commentary and wrong for a command: the first attempt at
   * printing a gate's instructions came out as one dim line ending in an
   * ellipsis, so it announced that options existed without naming any of them.
   */
  instructions: (lines: readonly string[]) => void
  agentStarted: (name: string, model: string, sessionId: string) => void
  agentFinished: (name: string, tokens: number, cost: number) => void
  retry: (name: string, attempt: number, limit: number, reason: string) => void
  gateResult: (name: string, report: { checks: readonly unknown[] }) => void
  envelopeSummary: (typeName: string, envelope: TEnvelopeBase) => void
  /**
   * What an agent is thinking or saying, printed only under `--stream`.
   *
   * Separate from `note` because it is the agent talking rather than the
   * factory reporting, and because a reader scanning for what the factory did
   * must be able to tell the two apart at a glance.
   */
  narrate: (agent: string, channel: 'thinking' | 'text', text: string) => void
}>

export type TRun = Readonly<{
  cfg: TPiCrustConfig
  runId: string
  tracer: TTracer
  console: TConsole
  engineer: string
  /**
   * Echo agent narration to the terminal as it arrives (`--stream`).
   *
   * On the run rather than on a activity: it describes whether a human is watching
   * this execution, which is true of the whole run or of none of it.
   */
  stream: boolean
  /**
   * How much this run's agents may decide for themselves, 0–100.
   *
   * On the run rather than on a activity: it describes the latitude granted to
   * this execution, which is true of the whole chain or of none of it.
   */
  trust: number
  /** absolute root of the codebase — where every agent is spawned to work */
  repoRoot: string
  /**
   * Absolute VCS root — `git rev-parse --show-toplevel`, resolved from
   * `repoRoot` once at run creation and carried from there.
   *
   * Equal to `repoRoot` in the ordinary case. Differs when the workspace is
   * one package of a monorepo, which is a supported layout: everything git
   * prints — a diff, an untracked file — is relative to THIS root, whatever
   * cwd git was given, where everything configuration names — prompts,
   * extensions, skills, `data_dir`, `writes` — stays relative to `repoRoot`.
   * See specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md.
   */
  vcsRoot: string
  sessionDir: string
  contextHandoffDir: string
  /**
   * ActivityRun names already recorded successful for this session.
   *
   * Empty unless the run was started with `--resume`. Populated from
   * `readRunState`, which is the same function the reporter reads, so the two
   * can never disagree about what is already done.
   */
  resume: ReadonlySet<string>
  /** the activity runs this run has opened, in order */
  activityRuns: () => readonly TActivityRun[]
  recordActivityRun: (activityRun: TActivityRun) => void
  updateActivityRun: (
    activityRunId: string,
    patch: Readonly<{
      status?: TActivityRunStatus
      error?: string
      ended_at?: string
    }>,
  ) => TActivityRun
  nextSeq: () => number
  tokens: () => number
  cost: () => number
  addUsage: (tokens: number, cost: number) => void
  agentMap: () => Readonly<Record<string, TAgentMapEntry>>
  saveAgentMap: (agent: string, entry: TAgentMapEntry) => void
}>

/** What an activity run body is handed. */
export type TActivityRunHandle = Readonly<{
  activityRun: TActivityRun
  log: (payload: Readonly<Record<string, unknown>>) => void
}>
