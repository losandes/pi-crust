import { join, resolve } from 'node:path'
import { errorMessage } from '../../../../../lib/typedefs'
import { appendText, ensureDir } from '../../../../lib/system'
import { appendSteering } from '../../../agents'
import type { resumeRecordedRun } from '../../../cli'
import {
  activitiesToReplay,
  activityRunsToCarry,
  activityRunsToSupersede,
  handoffDirFor,
  type seedingOf,
  steeringEntry,
} from '../../../handoff'
import {
  readRunState,
  recordBranchSteer,
  recordOverwriteSteer,
  runHasLiveProcess,
} from '../../../trace'
import { seedBranch } from '../..'

/**
 * `say`, mirrored into the branch's own spawn.log.
 *
 * A branch that fails after its session directory exists but before any row
 * is written has nothing for `startupFailure()` to read unless something
 * writes there directly, because the server's own capture of this process's
 * stdout lands beside the SOURCE run, not the branch, so a branch id the
 * server already handed a developer would otherwise explain itself nowhere.
 */
const sayToBranch =
  (say: (line: string) => void) =>
  (branchSessionDir: string, line: string): void => {
    say(line)
    appendText(join(branchSessionDir, 'spawn.log'), `${line}\n`)
  }

export const steerOverwrite =
  (ports: TSteerPorts) =>
  async (
    params: Readonly<{
      dbPath: string
      dataDir: string
      runId: string
      activity: string
      note: string
    }>,
  ): Promise<number> => {
    const say = ports.say
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
      steeringEntry(activity, note, ports.now()),
    )

    /*
     * Marking the standing activityRuns superseded is what makes the replay happen:
     * resume skips a activity whose latest activityRun succeeded, so this is exactly the
     * set that would otherwise be skipped. The rows stay — what the abandoned
     * path decided is still worth reading — they simply stop counting as done.
     */
    recordOverwriteSteer(dbPath)({
      runId,
      activity,
      note,
      replaying,
      superseding,
      now: ports.now,
    })

    say(`steering recorded in ${path}`)
    say(`replaying: ${replaying.join(' → ')}`)
    const resumed = ports.resume(
      resolve(dataDir, 'sessions', runId),
      'attached',
    )
    say(resumed.started ? `resumed: ${resumed.command}` : resumed.reason)
    if (!resumed.started) return 1
    return (await resumed.finished) ?? 0
  }

export const steerBranch =
  (ports: TSteerPorts) =>
  async (
    params: Readonly<{
      dbPath: string
      dataDir: string
      runId: string
      activity: string
      note: string
      seeding: ReturnType<typeof seedingOf>
      branchId: string
    }>,
  ): Promise<number> => {
    const say = ports.say
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
    const sayBranch = (line: string): void =>
      sayToBranch(say)(branchSessionDir, line)
    sayBranch(branchId)

    // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, the one place a branch's own failure becomes the branch's own spawn.log and an exit code, rather than a crash that explains itself nowhere
    try {
      const carry = activityRunsToCarry(state.activityRuns, activity).map(
        (activityRun) => activityRun.activity_run_id,
      )
      const at = ports.now()
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

      recordBranchSteer(dbPath)({
        runId,
        activity,
        note,
        replaying,
        branchId,
        seeding,
        carried: seeded.carried,
        at,
        now: ports.now,
      })

      sayBranch(`replaying: ${replaying.join(' \u2192 ')}`)
      const resumed = ports.resume(seeded.sessionDir, 'attached')
      sayBranch(
        resumed.started ? `resumed: ${resumed.command}` : resumed.reason,
      )
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

export type TSteerPorts = Readonly<{
  say: (line: string) => void
  resume: typeof resumeRecordedRun
  now: () => string
}>
