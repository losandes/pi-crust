#!/usr/bin/env bun

/**
 * Send a run back to a activity with new instructions.
 *
 *   just crust steer <run-id> <activity> --overwrite "what to change"
 *   just crust steer <run-id> <activity> --branch    "what to change" \
 *       [--seeding fork|fresh] [--branch-id <id>]
 *
 * The target and every activity after it run again, in the order the run
 * actually took, each reading the instruction. That is the point: a change
 * at the start of a chain is a change to all of it. To revise ONE activity
 * without disturbing what follows, use `amend` — that is a judgement you are
 * making about the change, and it should be made deliberately.
 *
 * `--overwrite` and `--branch` are both required to be typed, and neither is
 * the default. Overwrite discards the path you are steering away from;
 * branch keeps both as two runs — the source untouched, the branch a new run
 * seeded from it up to the branch point.
 *
 * `--seeding` only matters for `--branch`. `fork` (the default) copies each
 * agent's own conversation, so a replayed activity sees the attempt that was
 * rejected and the instruction that rejected it. `fresh` starts the agents
 * over against the handoff documents alone, which costs less and is the
 * right choice when the old conversation is the problem rather than the
 * context.
 *
 * `--branch-id` names the branch's run id instead of minting one. The server
 * uses this to report the branch's id before its detached child has written
 * a row; a terminal caller rarely needs it.
 *
 * env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.
 */

import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import {
  errorMessage,
  safeParseSettlement,
} from '../lib/typedefs/src/settlement'
import { appendSteering } from './domains/agents'
import { positionalArgs, resumeRecordedRun, STEER_CLI } from './domains/cli'
import { loadConfig } from './domains/config'
import {
  activitiesToReplay,
  activityRunsToCarry,
  activityRunsToSupersede,
  flagValue,
  handoffDirFor,
  seedingOf,
  steeringEntry,
  steerTargetOf,
} from './domains/handoff'
import { seedBranch } from './domains/runs'
import { readRunState, runHasLiveProcess } from './domains/trace'
import { repoRoot, resolveDataPaths } from './domains/workspace'
import { DEFAULT_DB } from './lib/contracts'
import {
  appendText,
  configPathFromEnv,
  dbPathFromEnv,
  ensureDir,
  newId,
  nowIso,
} from './lib/system'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

/**
 * `say`, mirrored into the branch's own spawn.log.
 *
 * A branch that fails after its session directory exists but before any row
 * is written has nothing for `startupFailure()` to read unless something
 * writes there directly, because the server's own capture of this process's
 * stdout lands beside the SOURCE run, not the branch, so a branch id the
 * server already handed a developer would otherwise explain itself nowhere.
 */
const sayToBranch = (branchSessionDir: string, line: string): void => {
  say(line)
  appendText(join(branchSessionDir, 'spawn.log'), `${line}\n`)
}

const USAGE = [
  'usage: just crust steer <run-id> <activity> <--overwrite|--branch> "instruction"',
  '         [--seeding fork|fresh]   branch only; fork is the default',
  '         [--branch-id <id>]       branch only; minted when absent, printed either way',
  '',
  '  --overwrite  the steered activities rewrite their own documents; the path',
  '               you are steering away from is not kept',
  '  --branch     a new run, seeded from this one up to the branch point;',
  '               both outcomes stay readable side by side',
  '',
  'Neither is the default. One of them destroys evidence, so it is typed.',
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.',
].join('\n')

const runOverwrite = async (params: {
  dbPath: string
  dataDir: string
  runId: string
  activity: string
  note: string
}): Promise<number> => {
  const { dbPath, dataDir, runId, activity, note } = params
  const state = readRunState(dbPath, runId)
  if (state === undefined) {
    say(`no run ${runId} in ${dbPath}`)
    return 1
  }

  const replaying = activitiesToReplay(state.activityRuns, activity)
  if (replaying.length === 0) {
    say(`no activity "${activity}" in run ${runId}`)
    return 1
  }
  const superseding = activityRunsToSupersede(state.activityRuns, activity)

  const handoffDir = handoffDirFor(dataDir, runId)
  const path = appendSteering(
    handoffDir,
    steeringEntry(activity, note, nowIso()),
  )

  /*
   * Marking the standing activityRuns superseded is what makes the replay happen:
   * resume skips a activity whose latest activityRun succeeded, so this is exactly the
   * set that would otherwise be skipped. The rows stay — what the abandoned
   * path decided is still worth reading — they simply stop counting as done.
   */
  const db = new Database(dbPath)
  db.run('PRAGMA busy_timeout=5000;')
  for (const activityRunId of superseding) {
    db.run(
      "UPDATE activity_runs SET status='superseded' WHERE activity_run_id=?",
      [activityRunId],
    )
  }
  db.run(
    'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
      ' VALUES (?,?,?,?,?,?)',
    [
      `evt_steer_${Date.now()}`,
      runId,
      'steer',
      `steer ${activity}`,
      JSON.stringify({
        target: 'overwrite',
        activity,
        note,
        replaying,
        superseded: superseding,
        at: nowIso(),
      }),
      nowIso(),
    ],
  )
  db.close()

  say(`steering recorded in ${path}`)
  say(`replaying: ${replaying.join(' → ')}`)
  const resumed = resumeRecordedRun(
    resolve(dataDir, 'sessions', runId),
    'attached',
  )
  say(resumed.started ? `resumed: ${resumed.command}` : resumed.reason)
  if (!resumed.started) return 1
  return (await resumed.finished) ?? 0
}

const runBranch = async (params: {
  dbPath: string
  dataDir: string
  runId: string
  activity: string
  note: string
  seeding: ReturnType<typeof seedingOf>
  branchId: string
}): Promise<number> => {
  const { dbPath, dataDir, runId, activity, note, seeding, branchId } = params
  const state = readRunState(dbPath, runId)
  if (state === undefined) {
    say(`no run ${runId} in ${dbPath}`)
    return 1
  }
  const replaying = activitiesToReplay(state.activityRuns, activity)
  if (replaying.length === 0) {
    say(`no activity "${activity}" in run ${runId}`)
    return 1
  }
  /*
   * A branch that copied a session directory out from under a writer would
   * not be a branch — it would be a race with whatever is still appending to
   * it. The same liveness check `--resume` already refuses on.
   */
  if (state.status === 'running' && runHasLiveProcess(dbPath, runId)) {
    say(
      `'${runId}' is still running — wait for it to finish, or stop it, before branching.`,
    )
    return 1
  }

  // The branch's own session directory exists from here on, so a failure
  // past this point explains itself on the branch's own page: every line
  // from here is said to both this terminal AND the branch's own spawn.log,
  // because the server's capture of this process's stdout lands beside the
  // SOURCE run, not a branch id it has already handed a developer.
  const branchSessionDir = resolve(dataDir, 'sessions', branchId)
  ensureDir(branchSessionDir)
  const sayBranch = (line: string): void => sayToBranch(branchSessionDir, line)
  sayBranch(branchId)

  // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, the one place a branch's own failure becomes the branch's own spawn.log and an exit code, rather than a crash that explains itself nowhere
  try {
    const carry = activityRunsToCarry(state.activityRuns, activity).map(
      (activityRun) => activityRun.activity_run_id,
    )
    const at = nowIso()
    const seeded = seedBranch({
      dbPath,
      dataDir,
      sourceRunId: runId,
      branchRunId: branchId,
      carry,
      seeding,
      at,
    })

    appendSteering(seeded.handoffDir, steeringEntry(activity, note, at))

    const db = new Database(dbPath)
    db.run('PRAGMA busy_timeout=5000;')
    db.run(
      'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
        ' VALUES (?,?,?,?,?,?)',
      [
        `evt_branch_${Date.now()}`,
        runId,
        'steer',
        `branch ${activity}`,
        JSON.stringify({
          target: 'branch',
          activity,
          note,
          branch_run_id: branchId,
          seeding,
          replaying,
          at,
        }),
        at,
      ],
    )
    db.run(
      'INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)' +
        ' VALUES (?,?,?,?,?,?)',
      [
        `evt_branched_${Date.now()}`,
        branchId,
        'log',
        'branched_from',
        JSON.stringify({
          from_run_id: runId,
          activity,
          seeding,
          carried: seeded.carried,
          at,
        }),
        at,
      ],
    )
    db.close()

    sayBranch(`replaying: ${replaying.join(' \u2192 ')}`)
    const resumed = resumeRecordedRun(seeded.sessionDir, 'attached')
    sayBranch(resumed.started ? `resumed: ${resumed.command}` : resumed.reason)
    if (!resumed.started) return 1
    return (await resumed.finished) ?? 0
  } catch (cause) {
    // Whatever broke is read by `startupFailure()` off the branch's OWN
    // spawn.log: a branch id the caller already has must explain its own
    // failure, not depend on a reader knowing to go look at the source run.
    sayBranch(`branch failed: ${errorMessage(cause)}`)
    return 1
  }
}

const main = (): Promise<number> => {
  const argv = process.argv.slice(2)
  const positionals = safeParseSettlement(() => positionalArgs(argv, STEER_CLI))
  if (positionals.status === 'error') {
    say(errorMessage(positionals.error))
    say(USAGE)
    return Promise.resolve(2)
  }
  const [runId, activity] = positionals.data
  const target = steerTargetOf(argv)
  const note = positionals.data.slice(2).join(' ').trim()

  if (
    runId === undefined ||
    activity === undefined ||
    target === undefined ||
    note === ''
  ) {
    say(USAGE)
    return Promise.resolve(2)
  }

  const cfg = loadConfig(configPathFromEnv())
  const resolved = resolveDataPaths(cfg, repoRoot())
  const dbPath = resolve(dbPathFromEnv() ?? resolved.db ?? DEFAULT_DB)
  const dataDir = resolved.dataDir

  if (target === 'overwrite') {
    return runOverwrite({ dbPath, dataDir, runId, activity, note })
  }

  const branchId = flagValue(argv, '--branch-id') ?? newId(8)
  return runBranch({
    dbPath,
    dataDir,
    runId,
    activity,
    note,
    seeding: seedingOf(argv),
    branchId,
  })
}

process.exitCode = await main()
