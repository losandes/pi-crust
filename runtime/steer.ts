#!/usr/bin/env bun
/**
 * Send a run back to a activity with new instructions.
 *
 *   just crust steer <run-id> <activity> --overwrite "what to change"
 *   just crust steer <run-id> <activity> --branch    "what to change"
 *
 * The target and every activity after it run again, in the order the run
 * actually took, each reading the instruction. That is the point: a change
 * at the start of a chain is a change to all of it. To revise ONE activity
 * without disturbing what follows, use `amend` — that is a judgement you are
 * making about the change, and it should be made deliberately.
 *
 * `--overwrite` and `--branch` are both required to be typed, and neither is
 * the default. Overwrite discards the path you are steering away from;
 * branch keeps both as two runs. A default on a choice where one option
 * destroys evidence is a choice made by habit rather than by a person.
 *
 * env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.
 */

import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { nowIso } from './modules/data/clock'
import { configPathFromEnv, dbPathFromEnv } from './modules/data/env-overrides'
import { appendSteering } from './modules/data/steering'
import { handoffDirFor } from './modules/data/handoff-pointer'
import { readRunState } from './modules/use-cases/read-run-state'
import { resumeRecordedRun } from './modules/use-cases/resume-run'
import {
  activityRunsToSupersede,
  steeringEntry,
  activitiesToReplay,
  type TSteerTarget,
} from './modules/use-cases/steer'
import { loadConfig } from './modules/use-cases/load-config'
import { DEFAULT_DB } from './modules/typedefs/config'

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const USAGE = [
  'usage: just crust steer <run-id> <activity> <--overwrite|--branch> "instruction"',
  '',
  '  --overwrite  the steered activities rewrite their own documents; the path',
  '               you are steering away from is not kept',
  '  --branch     a new run, seeded from this one up to the branch point;',
  '               both outcomes stay readable side by side',
  '',
  'Neither is the default. One of them destroys evidence, so it is typed.',
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.',
].join('\n')

const targetOf = (argv: readonly string[]): TSteerTarget | undefined => {
  const overwrite = argv.includes('--overwrite')
  const branch = argv.includes('--branch')
  // Both is not "either": it is somebody who has not decided.
  return overwrite === branch ? undefined : overwrite ? 'overwrite' : 'branch'
}

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2)
  const [runId, activity] = argv.filter((arg) => !arg.startsWith('--'))
  const target = targetOf(argv)
  const note = argv
    .filter((arg) => !arg.startsWith('--'))
    .slice(2)
    .join(' ')
    .trim()

  if (runId === undefined || activity === undefined || target === undefined || note === '') {
    say(USAGE)
    return 2
  }

  if (target === 'branch') {
    // Deliberately refused rather than quietly doing the other thing: a
    // branch and an overwrite differ in what survives, and a flag that
    // silently degrades into its opposite is worse than one that is absent.
    say('--branch is not implemented yet; --overwrite is.')
    return 2
  }

  const cfg = loadConfig(configPathFromEnv())
  const dbPath = resolve(dbPathFromEnv() ?? cfg.observability.db ?? DEFAULT_DB)
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

  const handoffDir = handoffDirFor(cfg.defaults.data_dir, runId)
  const path = appendSteering(handoffDir, steeringEntry(activity, note, nowIso()))

  /*
   * Marking the standing activityRuns superseded is what makes the replay happen:
   * resume skips a activity whose latest activityRun succeeded, so this is exactly the
   * set that would otherwise be skipped. The rows stay — what the abandoned
   * path decided is still worth reading — they simply stop counting as done.
   */
  const db = new Database(dbPath)
  db.run('PRAGMA busy_timeout=5000;')
  for (const activityRunId of superseding) {
    db.run("UPDATE activity_runs SET status='superseded' WHERE activity_run_id=?", [activityRunId])
  }
  db.run(
    "INSERT INTO events (event_id, run_id, type, name, payload_json, started_at)" +
      ' VALUES (?,?,?,?,?,?)',
    [
      `evt_steer_${Date.now()}`,
      runId,
      'steer',
      `steer ${activity}`,
      JSON.stringify({
        target,
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
    resolve(cfg.defaults.data_dir, 'sessions', runId),
    'attached',
  )
  say(resumed.started ? `resumed: ${resumed.command}` : resumed.reason)
  if (!resumed.started) return 1
  return (await resumed.finished) ?? 0
}

process.exitCode = await main()
