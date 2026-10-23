/**
 * Session lifecycle: pin-or-create an run_id, build the Run.
 *
 * `startSession(cfg, runId)` joins the session if it exists or creates it under
 * exactly that id (pinned ids for repeatable runs); omitted, a fresh id is
 * minted and printed so the next workflow can pick it up.
 */

import { writeText } from '../data/files'
import { basename, join, resolve } from 'node:path'
import { engineerName } from '../data/engineer'
import { currentBranch, repoRoot } from '../data/git'
import { recordedHandoffDir, writeHandoffPointer } from '../data/handoff-pointer'
import { newId } from '../data/ids'
import { createTracer } from '../data/trace-db'
import { runHasLiveProcess } from '../data/trace-reader'
import { registerWorkspace } from '../data/workspace-registry'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import type { TRunState } from '../typedefs/run-state'
import { TRUST_DEFAULT } from '../typedefs/trust'
import { createRun } from './create-run'
import { isSharedHandoffDir, resolveHandoffDir } from './handoff-location'
import { readRunState } from './read-run-state'

const SIGNALS = [
  ['SIGTERM', 15],
  ['SIGINT', 2],
] as const

/**
 * A killed run still closes its own trace.
 *
 * Without this, `kill <pid>` would leave the session reading `running` forever
 * and its process rows open — the trace would claim work is in flight that is
 * already dead.
 */
const finalizeWhenKilled = (run: TRun): void => {
  for (const [signal, number] of SIGNALS) {
    process.on(signal, () => {
      run.tracer.sessionFinish(run.runId, false) // also closes process rows
      process.exit(128 + number)
    })
  }
}

/** The script's own name — the fallback for `sessions.lifecycle`. */
const workflowName = (): string =>
  basename(process.argv[1] ?? 'crust').replace(/\.ts$/, '')

/**
 * What `sessions.lifecycle` says, which is what every surface calls this run.
 *
 * The script name alone was wrong for the one script most runs go through:
 * `compose.ts` runs whatever it was asked to run, so every `--lifecycle sdlc`
 * and every `--activities plan,build` read as `compose` — the same word for
 * all of them, naming the mechanism rather than the work. A named Lifecycle
 * says its own name; a chain spelled out at the call site has no name to
 * give, so it keeps the script's.
 */
export const sessionLifecycle = (lifecycle: string | undefined): string =>
  lifecycle === undefined || lifecycle === '' ? workflowName() : lifecycle

export type TSessionOptions = Readonly<{
  /** skip activityRuns already recorded successful for this run_id */
  resume?: boolean
  /** echo agent narration to the terminal as it arrives (`--stream`) */
  stream?: boolean
  /** how much the agents may decide for themselves, 0-100 */
  trust?: number
  /** the Lifecycle this run was asked for, when it was asked for by name */
  lifecycle?: string | undefined
  /** the raw --handoff value, unexpanded */
  handoff?: string | undefined
  /** the validated --name value */
  name?: string | undefined
}>

/**
 * Is there anything to pick up, and if not, why not — the pure rule a
 * resume judges itself by.
 *
 * Testable with no database, no process, and no session: give it the state
 * `readRunState` already computed and the answer to one liveness probe.
 *
 * `state.resumable` carries nearly the whole rule — a session's own status
 * says whether it finished on its own terms, including the case a WAITING
 * run used to fall through on: the thing it was waiting for was a person,
 * and they have now answered, so `waiting` is resumable exactly as a `fail`
 * is. The one thing a session's status cannot say on its own is whether a
 * `running` session is still live or was `SIGKILL`ed with nothing left to
 * close its rows — that needs the process table, which is why a `running`
 * session is refused only when a live process is still found for it.
 */
export type TResumeVerdict = Readonly<{ ok: boolean; reason: string }>

export const resumeVerdict = (
  state: TRunState | undefined,
  runId: string,
  hasLiveProcess: boolean,
): TResumeVerdict => {
  if (state === undefined) {
    return { ok: false, reason: `no session '${runId}' — nothing to resume` }
  }
  if (!state.resumable) {
    return {
      ok: false,
      reason:
        `'${runId}' finished successfully — nothing to resume. ` +
        'Drop --run-id to start a new run.',
    }
  }
  if (state.status === 'running' && hasLiveProcess) {
    return {
      ok: false,
      reason:
        `'${runId}' is still running — run \`just crust procs ${runId}\` to see ` +
        'what is live, or wait for it to finish.',
    }
  }
  return { ok: true, reason: '' }
}

/**
 * Which activityRuns this run must not do again.
 *
 * Read through `readRunState` — the reporter's function — so `just crust
 * report` and `--resume` cannot disagree. Resuming needs an run_id, because
 * resuming an unnamed session is resuming nothing.
 */
const completedActivityRuns = (
  cfg: TPiCrustConfig,
  runId: string | undefined,
): ReadonlySet<string> => {
  if (runId === undefined || runId === '') {
    throw new Error(
      '--resume needs --run-id: name the session to pick up. ' +
        'Run `just crust report` to see the most recent one.',
    )
  }
  const state = readRunState(cfg.observability.db, runId)
  const hasLiveProcess =
    state?.status === 'running' && runHasLiveProcess(cfg.observability.db, runId)
  const verdict = resumeVerdict(state, runId, hasLiveProcess)
  if (!verdict.ok) {
    throw new Error(verdict.reason)
  }
  return new Set((state as TRunState).completed)
}

/**
 * Where this run's handoff directory actually is, honouring an existing
 * pointer over a fresh `--handoff` value.
 *
 * A resumed run's pointer WINS: resuming is how `resumeArgv` replays the
 * original `--handoff` verbatim, so the ordinary case never trips this, and
 * a `--handoff` that resolves to a different directory than the recorded
 * pointer is refused rather than silently splitting one run's documents
 * across two places.
 */
const resolvedHandoffDirFor = (
  cfg: TPiCrustConfig,
  runId: string,
  sessionDir: string,
  options: TSessionOptions,
): string => {
  const resolved = resolveHandoffDir({
    repoRoot: resolve(repoRoot()),
    dataDir: cfg.defaults.data_dir,
    runId,
    override: options.handoff,
  })
  const existing = recordedHandoffDir(sessionDir)
  if (existing === undefined) {
    return resolved
  }
  if (options.handoff !== undefined && resolved !== existing) {
    throw new Error(
      `--handoff resolves to ${resolved}, but '${runId}' already recorded ` +
        `${existing} — a resume cannot split one run's documents across two ` +
        'directories. Drop --handoff to keep the recorded one.',
    )
  }
  return existing
}

export const startSession = (
  cfg: TPiCrustConfig,
  runId?: string,
  options: TSessionOptions = {},
): TRun => {
  const resume = options.resume
    ? completedActivityRuns(cfg, runId)
    : new Set<string>()
  const id = runId || newId(8)
  const sessionDir = join(cfg.defaults.data_dir, 'sessions', id)
  const handoffDir = resolvedHandoffDirFor(cfg, id, sessionDir, options)
  const tracer = createTracer(
    cfg.observability.db,
    join(cfg.defaults.data_dir, 'sessions', id, 'events.jsonl'),
  )
  const run = createRun({
    cfg,
    runId: id,
    tracer,
    engineer: engineerName(),
    resume,
    stream: options.stream ?? false,
    trust: options.trust ?? TRUST_DEFAULT,
    handoffDir,
  })
  if (recordedHandoffDir(sessionDir) === undefined) {
    writeHandoffPointer(sessionDir, handoffDir)
  }
  tracer.sessionStart(
    id,
    run.engineer,
    sessionLifecycle(options.lifecycle),
    options.name,
  )
  // Where the work is happening, not where the observer is. One UI can watch
  // several working trees at once, and a run that cannot name its own tree is
  // a run the reader cannot act on.
  tracer.sessionWorkspace(id, run.repoRoot, currentBranch())
  /*
   * Tell the machine this tree exists, so an observer started later can find
   * it. Registration happens here rather than from the UI because the first
   * run in a new worktree is both the one most worth watching and the one
   * that happens before anybody opens the UI.
   */
  registerWorkspace(run.repoRoot, tracer.dbPath)
  // This process is the run. Record it before any activityRun opens, so a run that
  // hangs in its first agent call is still killable by run_id.
  tracer.processStart(
    id,
    'run',
    '',
    process.pid,
    [workflowName(), ...process.argv.slice(2)].join(' '),
  )
  /*
   * How this run was launched, written where anything that wants to resume it
   * can read it.
   *
   * The flags are NOT otherwise recoverable. `--approve-after plan` lives only
   * in argv, and the processes table stores the command space-joined, which
   * loses the boundaries of a prompt that contains spaces. A resumer
   * reconstructing from that would drop the gate the developer asked for, or
   * split their prompt into six arguments.
   */
  writeText(
    join(run.sessionDir, 'invocation.json'),
    `${JSON.stringify({ argv: process.argv.slice(0, 2).concat(process.argv.slice(2)), cwd: process.cwd() }, null, 2)}\n`,
  )
  finalizeWhenKilled(run)
  run.console.sessionStarted(id, run.engineer)
  if (isSharedHandoffDir(handoffDir, id)) {
    run.console.note(
      `handoff directory ${handoffDir} carries no run id — it is shared with ` +
        'any other run pointed at it.',
    )
  }
  if (resume.size > 0) {
    run.console.note(
      `resuming: ${resume.size} activityRun(s) already successful — ` +
        `${[...resume].join(', ')}`,
    )
  }
  return run
}
