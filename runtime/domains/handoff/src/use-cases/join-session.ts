import type { TSettlement } from '../../../../../lib/typedefs'
import type { TActivityRunState } from '../../../../lib/contracts'
import { sessionDirFor } from './consult'

export type TJoinRequest = Readonly<{ runId: string; activity: string }>

export type TJoinPorts = Readonly<{
  dataDir: string
  runState: (runId: string) =>
    | Readonly<{
        activityRuns: readonly Readonly<
          Pick<TActivityRunState, 'seq' | 'name' | 'kind' | 'owner'>
        >[]
      }>
    | undefined
  hasLiveProcess: (runId: string) => boolean
  agentSession: (
    runId: string,
    agent: string,
  ) => Readonly<{ sessionId: string }> | undefined
  sessionFile: (sessionDir: string, sessionId: string) => string | undefined
}>

export type TJoinTarget = Readonly<{
  agent: string
  sessionId: string
  sessionFile: string
}>

export type TJoinRefusalReason =
  | 'unknown-run'
  | 'still-running'
  | 'unknown-activity'
  | 'no-conversation'
  | 'history-missing'

export type TJoinRefusal = Readonly<{
  reason: TJoinRefusalReason
  message: string
}>

export const resolveJoin =
  (ports: TJoinPorts) =>
  ({
    runId,
    activity,
  }: TJoinRequest): TSettlement<TJoinTarget, TJoinRefusal> => {
    const state = ports.runState(runId)
    if (state === undefined) {
      return {
        status: 'error',
        error: {
          reason: 'unknown-run',
          message: `no run "${runId}" was found, so activity "${activity}" cannot be joined`,
        },
      }
    }
    if (ports.hasLiveProcess(runId)) {
      return {
        status: 'error',
        error: {
          reason: 'still-running',
          message: `run "${runId}" is still running; wait for it to finish or stop it before joining activity "${activity}"`,
        },
      }
    }
    const latest = state.activityRuns
      .filter((entry) => entry.name === activity)
      .toSorted((a, b) => b.seq - a.seq)[0]
    if (latest === undefined) {
      return {
        status: 'error',
        error: {
          reason: 'unknown-activity',
          message: `run "${runId}" has no activity "${activity}"`,
        },
      }
    }
    if (latest.kind !== 'agent') {
      return {
        status: 'error',
        error: {
          reason: 'no-conversation',
          message: `activity "${activity}" in run "${runId}" has no conversation to join: it was not performed by an agent`,
        },
      }
    }
    const agent = latest.owner
    const session = ports.agentSession(runId, agent)
    if (session === undefined) {
      return {
        status: 'error',
        error: {
          reason: 'no-conversation',
          message: `activity "${activity}" in run "${runId}" has no conversation to join: agent "${agent}" recorded no pi session`,
        },
      }
    }
    const { sessionId } = session
    const dir = sessionDirFor(ports.dataDir, runId, agent)
    const sessionFile = ports.sessionFile(dir, sessionId)
    if (sessionFile === undefined) {
      return {
        status: 'error',
        error: {
          reason: 'history-missing',
          message: `the conversation of activity "${activity}" in run "${runId}" is no longer available: no pi session "${sessionId}" in ${dir}`,
        },
      }
    }
    return { status: 'ok', data: { agent, sessionId, sessionFile } }
  }

export const joinArgv = (
  piBinary: string,
  sessionFile: string,
): readonly string[] => [piBinary, '--session', sessionFile]
