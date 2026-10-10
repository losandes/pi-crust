/**
 * Session lifecycle: pin-or-create an run_id, build the Run.
 *
 * `startSession(cfg, runId)` joins the session if it exists or creates it under
 * exactly that id (pinned ids for repeatable runs); omitted, a fresh id is
 * minted and printed so the next workflow can pick it up.
 */

import { writeText } from '../data/files'
import { basename, join } from 'node:path'
import { engineerName } from '../data/engineer'
import { currentBranch } from '../data/git'
import { newId } from '../data/ids'
import { createTracer } from '../data/trace-db'
import { registerWorkspace } from '../data/workspace-registry'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TRun } from '../typedefs/run'
import { TRUST_DEFAULT } from '../typedefs/trust'
import { createRun } from './create-run'
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

/** The workflow's own name, for `sessions.lifecycle`. */
const workflowName = (): string =>
  basename(process.argv[1] ?? 'crust').replace(/\.ts$/, '')

export type TSessionOptions = Readonly<{
  /** skip phases already recorded successful for this run_id */
  resume?: boolean
  /** echo agent narration to the terminal as it arrives (`--stream`) */
  stream?: boolean
  /** how much the agents may decide for themselves, 0-100 */
  trust?: number
}>

/**
 * Which phases this run must not do again.
 *
 * Read through `readRunState` — the reporter's function — so `just crust report`
 * and `--resume` cannot disagree. Resuming needs an run_id, because resuming an
 * unnamed session is resuming nothing; and a session with every phase green has
 * nothing left to do, which is said out loud rather than silently re-run.
 */
const completedPhases = (
  cfg: TPiCrustConfig,
  runId: string | undefined,
): ReadonlySet<string> => {
  if (runId === undefined || runId === '') {
    throw new Error(
      '--resume needs --run-id: name the session to pick up. ' +
        'Run `bun .pi-crust/report.ts` to see the most recent one.',
    )
  }
  const state = readRunState(cfg.observability.db, runId)
  if (state === undefined) {
    throw new Error(
      `no session '${runId}' in ${cfg.observability.db} — nothing to resume`,
    )
  }
  /*
   * A WAITING run always has something to do, even when every phase it
   * recorded succeeded: the thing it was waiting for was a person, and they
   * have now answered. Refusing here left such a run `waiting` for ever —
   * work finished, decision made, nothing to mark it done.
   *
   * `resume_from` cannot tell the difference on its own. It names the first
   * RECORDED phase that is not successful, and a chain stopped at its first
   * gate has not recorded the stages it never reached.
   */
  if (state.resume_from === undefined && state.status !== 'waiting') {
    throw new Error(
      `every phase of '${runId}' already succeeded — nothing to resume. ` +
        'Drop --run-id to start a new run.',
    )
  }
  return new Set(state.completed)
}

export const startSession = (
  cfg: TPiCrustConfig,
  runId?: string,
  options: TSessionOptions = {},
): TRun => {
  const resume = options.resume
    ? completedPhases(cfg, runId)
    : new Set<string>()
  const id = runId || newId(8)
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
  })
  tracer.sessionStart(id, run.engineer, workflowName())
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
  // This process is the run. Record it before any phase opens, so a run that
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
  if (resume.size > 0) {
    run.console.note(
      `resuming: ${resume.size} phase(s) already successful — ` +
        `${[...resume].join(', ')}`,
    )
  }
  return run
}
