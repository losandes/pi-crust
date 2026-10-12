/**
 * What a run got to: the shape the reporter prints and `--resume` reads.
 *
 * This is a wire contract. `report.ts --json` emits exactly this, and an agent
 * branches on it, so a field only changes deliberately. `completed` is a list
 * rather than a Set because JSON has neither.
 */

import type { TGateCheck } from './gate'
import type { TEventPayload } from './trace'

export type TGateOutcome = Readonly<{
  gate: string
  activityRun: string
  passed: boolean
  violations: readonly string[]
  checks: readonly TGateCheck[]
}>

export type TEnvelopeRecord = Readonly<{
  activityRun: string
  agent: string
  output_type: string
  valid: boolean
  payload: Readonly<Record<string, unknown>>
}>

/**
 * One `log` event, with the name it was filed under.
 *
 * The name matters on replay: the console echoes every activity run line as a `log`
 * too, so "the last log" is usually a human sentence rather than the verdict a
 * code activity recorded. An Activity files its own result under the
 * `step_result` event name — a wire value older traces already carry — and asks
 * for it back by that name.
 */
export type TActivityRunLog = Readonly<{
  name: string
  payload: TEventPayload
}>

export type TActivityRunState = Readonly<{
  seq: number
  activity_run_id: string
  name: string
  kind: string
  owner: string
  description: string
  status: string
  error: string | undefined
  started_at: string | undefined
  ended_at: string | undefined
  gates: readonly TGateOutcome[]
  logs: readonly TActivityRunLog[]
}>

export type TRunState = Readonly<{
  run_id: string
  lifecycle: string
  request: string
  status: string
  engineer: string
  started_at: string | undefined
  ended_at: string | undefined
  tokens: number
  cost: number
  activityRuns: readonly TActivityRunState[]
  /** activityRun NAMES whose LATEST record is success */
  completed: readonly string[]
  /** first activityRun, in seq order, whose latest record is not success */
  resume_from: string | undefined
  /** failed gates, newest Activity Run per gate, newest activityRun first */
  failed_gates: readonly TGateOutcome[]
  envelopes: readonly TEnvelopeRecord[]
}>

/**
 * What a reporter or a workflow exits with. Something will branch on these.
 *
 * `WAITING` and `RUNNING` exist because the old vocabulary conflated them
 * with failure: a report on a healthy in-flight run exited 1, so `just crust
 * report` printed `recipe failed` over a run that was going fine.
 */
export const EXIT = {
  SUCCESS: 0,
  FAILED: 1,
  USAGE: 2,
  WAITING: 3,
  RUNNING: 4,
} as const

export type TExitCode = (typeof EXIT)[keyof typeof EXIT]
