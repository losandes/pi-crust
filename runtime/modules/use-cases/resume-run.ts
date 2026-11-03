/**
 * Picking a waiting run back up, exactly as it was launched.
 *
 * Approve, reject and answer all mean "carry on". Printing the command to type
 * made one intention into two actions, and the command itself was a guess:
 * reconstructed from the session row, it dropped every flag the run was
 * started with.
 *
 * `invocation.json` exists for this. The run writes its own argv at startup,
 * so the only thing added here is `--run-id` and `--resume`.
 */

import { join } from 'node:path'
import { fileExists, readText } from '../data/files'
import { longFlagArgv } from './parse-cli'

export const INVOCATION_FILENAME = 'invocation.json'

export type TResumption = Readonly<{
  started: boolean
  /** What was run, for the developer to see or to copy if it failed. */
  command: string
  reason: string
  /** Resolves with the run's exit code when attached; undefined when detached. */
  finished?: Promise<number>
}>

/**
 * Whether the caller intends to wait for the run it just restarted.
 *
 * `attached` streams the run's output to this terminal and resolves when it
 * ends, which is what somebody who typed `approve` and is still sitting there
 * expects: starting a run from a terminal and resuming one are the same act,
 * and they should not behave differently.
 *
 * `detached` is for a caller that CANNOT wait — an HTTP handler must answer
 * its request in milliseconds, and the chain it restarted may run for an
 * hour. Its output goes to the session's own log instead.
 */
export type TAttachment = 'attached' | 'detached'

/**
 * The argv to resume with: the original, minus its own resume flags, plus
 * this run's id and `--resume`.
 *
 * Stripping and re-appending rather than leaving them in place keeps the line
 * identical whether this is the first gate or the fourth, so two commands that
 * do the same thing look the same. `longFlagArgv` runs first because the
 * strip filter below only matches `--run-id` and `--resume` by their long
 * names — a run launched with `-id`/`-r` would otherwise keep both the old
 * short flag and the new long one.
 */
export const resumeArgv = (
  argv: readonly string[],
  runId: string,
): readonly string[] => {
  const canonical = longFlagArgv(argv)
  const script = canonical[1] ?? ''
  const carried = canonical
    .slice(2)
    .filter(
      (arg, index, all) =>
        arg !== '--run-id' &&
        all[index - 1] !== '--run-id' &&
        arg !== '--resume',
    )
  return [script, ...carried, '--run-id', runId, '--resume']
}

/** What a run recorded about how it was started, or undefined if it did not. */
export const recordedInvocation = (
  sessionDir: string,
): Readonly<{ argv: readonly string[]; cwd: string }> | undefined => {
  const path = join(sessionDir, INVOCATION_FILENAME)
  if (!fileExists(path)) return undefined
  const parsed: unknown = JSON.parse(readText(path))
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as { argv?: unknown; cwd?: unknown }
  const argv = Array.isArray(record.argv)
    ? record.argv.filter((part): part is string => typeof part === 'string')
    : []
  if (argv.length < 2) return undefined
  return {
    argv,
    cwd: typeof record.cwd === 'string' ? record.cwd : process.cwd(),
  }
}

/**
 * Start the run again and return what was run.
 *
 * This used to detach unconditionally, which made resuming feel unlike
 * starting: `just crust sdlc` stays attached and prints as it goes, while
 * `approve` printed one line and dropped you back at a prompt with an hour of
 * work happening invisibly. Attachment is not this function's decision — it
 * belongs to whoever called it, because only the caller knows whether it can
 * afford to wait.
 */
export const resumeRecordedRun = (
  sessionDir: string,
  attachment: TAttachment = 'attached',
): TResumption => {
  const recorded = recordedInvocation(sessionDir)
  if (recorded === undefined) {
    return {
      started: false,
      command: '',
      reason: `no ${INVOCATION_FILENAME} in ${sessionDir} — resume it by hand`,
    }
  }
  const runId = sessionDir.split('/').filter(Boolean).at(-1) ?? ''
  const argv = resumeArgv(recorded.argv, runId)
  const command = `bun ${argv.join(' ')}`

  if (attachment === 'detached') {
    /*
     * Output to the session's own log, because there is no terminal to send
     * it to. The caller is an HTTP handler, and the run must outlive the
     * request that asked for it.
     */
    const log = join(sessionDir, 'resume.log')
    const child = Bun.spawn(['bun', ...argv], {
      cwd: recorded.cwd,
      stdin: 'ignore',
      stdout: Bun.file(log),
      stderr: Bun.file(log),
      env: { ...process.env },
    })
    child.unref()
    return { started: true, command, reason: '' }
  }

  /*
   * Inherited, not piped: the resumed run draws boxes, clears lines and asks
   * its own questions at the next gate. Piping would strip it of the terminal
   * it is drawing for, and `inherit` also means Ctrl-C reaches the run itself
   * rather than orphaning it behind a dead parent.
   */
  const child = Bun.spawn(['bun', ...argv], {
    cwd: recorded.cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  })
  return { started: true, command, reason: '', finished: child.exited }
}
