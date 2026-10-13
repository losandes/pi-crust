/**
 * The Run: config + run_id + agent map + tracer + console, bound once.
 *
 * Every number a run accumulates lives in this closure. Nothing outside it
 * holds a mutable record, so no layer can be handed a value and change it.
 */

import { join, resolve } from 'node:path'
import { ensureDir, fileExists, readText, writeText } from '../data/files'
import { repoRoot } from '../data/git'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TActivityRun } from '../typedefs/activity-run'
import type { TAgentMapEntry, TRun } from '../typedefs/run'
import type { TTracer } from '../typedefs/trace'
import { TRUST_DEFAULT } from '../typedefs/trust'
import { createConsole } from './report-to-console'

export type TCreateRunParams = Readonly<{
  cfg: TPiCrustConfig
  runId: string
  tracer: TTracer
  engineer: string
  /** activityRun names already successful in this session; empty unless resuming */
  resume?: ReadonlySet<string>
  /** echo agent narration to the terminal (`--stream`); off unless watched */
  stream?: boolean
  /** how much the agents may decide for themselves, 0-100 */
  trust?: number
  /** absolute; defaults to join(sessionDir, 'context_handoff') */
  handoffDir?: string
}>

export const createRun = (params: TCreateRunParams): TRun => {
  const { cfg, runId, tracer, engineer } = params
  const sessionDir = ensureDir(join(cfg.defaults.data_dir, 'sessions', runId))
  const contextHandoffDir = ensureDir(
    params.handoffDir ?? join(sessionDir, 'context_handoff'),
  )
  const agentMapPath = join(sessionDir, 'agent_map.json')

  let activityRuns: readonly TActivityRun[] = []
  let tokens = 0
  let cost = 0
  // A joined run continues the sequence rather than restarting at 1.
  let seq = tracer.maxActivityRunSeq(runId)
  let agentMap: Record<string, TAgentMapEntry> = fileExists(agentMapPath)
    ? (JSON.parse(readText(agentMapPath)) as Record<string, TAgentMapEntry>)
    : {}

  return {
    cfg,
    runId,
    tracer,
    console: createConsole(tracer, runId),
    engineer,
    stream: params.stream ?? false,
    trust: params.trust ?? TRUST_DEFAULT,
    repoRoot: resolve(repoRoot()),
    sessionDir,
    contextHandoffDir,
    resume: params.resume ?? new Set<string>(),

    activityRuns: () => activityRuns,

    recordActivityRun: (activityRun) => {
      activityRuns = [...activityRuns, activityRun]
    },

    updateActivityRun: (activityRunId, patch) => {
      const existing = activityRuns.find((activityRun) => activityRun.activity_run_id === activityRunId)
      if (existing === undefined) {
        throw new Error(`no such activityRun on this run: ${activityRunId}`)
      }
      const updated: TActivityRun = { ...existing, ...patch }
      activityRuns = activityRuns.map((activityRun) =>
        activityRun.activity_run_id === activityRunId ? updated : activityRun,
      )
      return updated
    },

    nextSeq: () => {
      seq += 1
      return seq
    },

    tokens: () => tokens,
    cost: () => cost,

    // run totals mirror what the tracer accumulates in sqlite
    addUsage: (spentTokens, spentCost) => {
      tokens += spentTokens
      cost += spentCost
      tracer.sessionAddUsage(runId, spentTokens, spentCost)
    },

    agentMap: () => ({ ...agentMap }),

    saveAgentMap: (agent, entry) => {
      agentMap = { ...agentMap, [agent]: entry }
      writeText(agentMapPath, `${JSON.stringify(agentMap, null, 2)}\n`)
    },
  }
}
