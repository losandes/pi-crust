/**
 * The path policy, enforced inside the harness, before a tool runs.
 *
 * Loaded into every agent pi-crust spawns (`pi -e`), so an Activity cannot opt
 * out of it by what its roster entry declares. It reads the run's policy from
 * a JSON file named by `CRUST_PATH_POLICY` — written by the runtime just
 * before the spawn, because an extension is loaded by path and is passed no
 * arguments.
 *
 * `tool_call` is the one event that can refuse a call before it executes,
 * which is the whole reason this exists: every other check in pi-crust runs
 * afterwards, and a secret that has been read cannot be unread. A blocked
 * call reaches the model as a refusal in the turn where it asked, so it can
 * report that in its envelope rather than failing in a way nobody can read.
 *
 * Nothing here reverts, deletes or restores anything. There is nothing to
 * undo, which is the point of acting before rather than after.
 *
 * This file is the adapter and nothing else: environment in, git in, one
 * JSONL line per governed call out. What is governed, and what each verb
 * means, is in `domains/policy/src/use-cases/path-policy.ts`, which is pure
 * and tested — including the decision this handler returns.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import type {
  TGoverned,
  TPathSettings,
  TRefusal,
  TToolCall,
} from '../domains/policy'
import { governToolCall, refusalMessage } from '../domains/policy'

/** The slice of pi's extension API this file uses. */
type TToolCallEvent = Readonly<{
  toolName: string
  input?: Readonly<Record<string, unknown>>
}>

type TPi = Readonly<{
  on: (
    event: 'tool_call',
    handler: (
      event: TToolCallEvent,
    ) => Readonly<{ block: boolean; reason: string }> | undefined,
  ) => unknown
}>

type TRunPolicy = TPathSettings &
  Readonly<{
    /** where this run wants the record of governed calls */
    refusalsPath: string
  }>

const settings = (): TRunPolicy | undefined => {
  const path = process.env.CRUST_PATH_POLICY
  if (path === undefined || path === '') {
    return undefined
  }
  // biome-ignore lint/plugin/no-intermediate-try-catch: this is the boundary — an unreadable policy is reported on stderr and governs nothing, because there is nobody above to settle it
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as TRunPolicy
  } catch {
    /*
     * A policy that cannot be read is not a policy that permits everything,
     * but it is also not something this extension can repair from inside an
     * agent's process. It declines to govern and says so on stderr, which
     * lands in the run's own stream rather than in the model's context.
     */
    process.stderr.write(
      `pi-crust path policy: could not read ${path}; nothing is governed\n`,
    )

    return undefined
  }
}

/** Membership is git's answer, never a second implementation of `.gitignore`. */
const ignoredIn = (repoRoot: string) => (path: string) =>
  spawnSync('git', ['check-ignore', '--quiet', '--', path], {
    cwd: repoRoot,
  }).status === 0

const record = (policy: TRunPolicy, refusals: readonly TRefusal[]): void => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: the record of a refusal is worth less than the refusal, and a failed append must never turn a blocked call into an allowed one
  try {
    appendFileSync(
      policy.refusalsPath,
      refusals.map((one) => `${JSON.stringify(one)}\n`).join(''),
    )
  } catch {
    // The record of a refusal is worth less than the refusal itself, and a
    // failed append must never turn a blocked call into an allowed one.
  }
}

export const activate = (pi: TPi): void => {
  const policy = settings()
  if (policy === undefined) {
    return
  }
  const isIgnored = ignoredIn(policy.repoRoot)

  pi.on('tool_call', (event) => {
    const call: TToolCall = {
      toolName: event.toolName,
      input: event.input ?? {},
    }
    const governed: TGoverned = governToolCall({
      call,
      settings: policy,
      isIgnored,
    })
    if (governed.refusals.length > 0) {
      record(policy, governed.refusals)
    }

    return governed.blocked === undefined
      ? undefined
      : { block: true, reason: refusalMessage(governed.blocked) }
  })
}

export default activate
