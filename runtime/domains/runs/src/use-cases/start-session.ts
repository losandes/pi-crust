import { programName } from '../../../../lib/system'
/**
 * Session lifecycle: pin-or-create an run_id, build the Run.
 *
 * `startSession(cfg, runId)` joins the session if it exists or creates it under
 * exactly that id (pinned ids for repeatable runs); omitted, a fresh id is
 * minted and printed so the next workflow can pick it up.
 */

import { join, resolve } from 'node:path'
import { repositoryPathAt } from '../../../../../lib/repository-path'
import {
  claimRunDirectory,
  runIdTaken,
  sessionsDirIn,
} from '../../../../../lib/run-directories'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import type { TPiCrustConfig, TRun, TRunState } from '../../../../lib/contracts'
import { TRUST_DEFAULT } from '../../../../lib/contracts'
import { newId, writeText } from '../../../../lib/system'
import {
  isSharedHandoffDir,
  recordedHandoffDir,
  resolveHandoffDir,
  writeHandoffPointer,
} from '../../../handoff'
import { createTracer, readRunState, runHasLiveProcess } from '../../../trace'
import {
  currentBranch,
  engineerName,
  primaryWorktree,
  repoRoot,
  resolveDataPaths,
} from '../../../workspace'
import { createRun } from './create-run'

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
const workflowName = (): string => programName(process.argv[1] ?? 'crust')

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
        `'${runId}' is still running — run \`crust procs ${runId}\` to see ` +
        'what is live, or wait for it to finish.',
    }
  }
  return { ok: true, reason: '' }
}

/**
 * Which activityRuns this run must not do again.
 *
 * Read through `readRunState` — the reporter's function — so `crust
 * report` and `--resume` cannot disagree. Resuming needs an run_id, because
 * resuming an unnamed session is resuming nothing.
 */
const completedActivityRuns = (
  dbPath: string,
  runId: string | undefined,
): ReadonlySet<string> => {
  if (runId === undefined || runId === '') {
    throw new Error(
      '--resume needs --run-id: name the session to pick up. ' +
        'Run `crust report` to see the most recent one.',
    )
  }
  const state = readRunState(dbPath, runId)
  const hasLiveProcess =
    state?.status === 'running' && runHasLiveProcess(dbPath, runId)
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
  workspaceRoot: string,
  runId: string,
  sessionDir: string,
  options: TSessionOptions,
): string => {
  const resolved = resolveHandoffDir({
    repoRoot: workspaceRoot,
    runDir: sessionDir,
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

/**
 * A session directory id that is not already taken (1.4.2).
 *
 * A pooled store (1.4.1) holds every tree's sessions in one directory, which
 * reaches a 32-bit id's (`newId(8)`) collision odds sooner than a per-tree
 * store did. Joining an existing directory would interleave two runs'
 * prompts, envelopes and handoff documents, so a collision is retried
 * rather than reused — this never fires for a PINNED id (`--run-id`,
 * including a resume), which is supposed to find an existing directory.
 *
 * `mint` and `taken` are parameters so this is provable without 2^32 tries:
 * a test can make `taken` answer true for exactly the ids it wants refused.
 */
export const freshSessionId = (
  mint: () => string,
  taken: (candidate: string) => boolean,
): string => {
  const candidate = mint()
  return taken(candidate) ? freshSessionId(mint, taken) : candidate
}

export const startSession = (
  cfg: TPiCrustConfig,
  runId?: string,
  options: TSessionOptions = {},
): TRun => {
  const workspaceRoot = resolve(repoRoot())
  const { dataDir, db } = resolveDataPaths(cfg, workspaceRoot)
  const resume = options.resume
    ? completedActivityRuns(db, runId)
    : new Set<string>()
  const store = { dbPath: db, sessionsDir: sessionsDirIn(dataDir) }
  const id = runId || freshSessionId(() => newId(8), runIdTaken(store))
  const claimed = claimRunDirectory(store)(id, repositoryPathAt(workspaceRoot))
  if (claimed.status === 'error') throw new Error(claimed.error.message)
  const sessionDir = claimed.data
  const handoffDir = resolvedHandoffDirFor(
    workspaceRoot,
    id,
    sessionDir,
    options,
  )
  const tracer = createTracer(db, join(sessionDir, 'events.jsonl'))
  const run = createRun({
    cfg,
    runId: id,
    tracer,
    engineer: engineerName(),
    resume,
    stream: options.stream ?? false,
    trust: options.trust ?? TRUST_DEFAULT,
    handoffDir,
    sessionDir,
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
  const repository = safeParseSettlement(() => primaryWorktree(run.repoRoot))
  tracer.sessionWorkspace(
    id,
    run.repoRoot,
    currentBranch(),
    run.vcsRoot === run.repoRoot ? '' : run.vcsRoot,
    repository.status === 'ok' ? repository.data : '',
  )
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
  run.console.sessionStarted(id, run.engineer, run.repoRoot, run.vcsRoot)
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
