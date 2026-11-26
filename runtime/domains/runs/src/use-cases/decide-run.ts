import { join } from 'node:path'
import {
  resolveRunDirectory,
  sessionsDirIn,
} from '../../../../../lib/run-directories'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { DEFAULT_DB, EXIT } from '../../../../lib/contracts'
import { fileExists, readText, writeText } from '../../../../lib/system'
import { box, paint, writeLine } from '../../../../lib/terminal'
import type { TDecideArgs } from '../../../cli'
import { resumeRecordedRun } from '../../../cli'
import { loadConfig } from '../../../config'
import { handoffDirFor } from '../../../handoff'
import { readRunState } from '../../../trace'
import { engineerName, repoRoot, resolveDataPaths } from '../../../workspace'
import { ANSWER_FILENAME, ANSWER_RECORD_FILENAME } from '../..'

/**
 * What gets written for the next stage to read.
 *
 * `reject` is not a different mechanism from `answer` — both are a person
 * saying something the chain must treat as established. They differ only in
 * what that something is.
 */
export const answerText = (args: TDecideArgs): string => {
  if (args.verb === 'approve') {
    return 'Approved to continue, with no further instruction.'
  }
  if (args.verb === 'reject') {
    if (args.note.trim() === '') {
      throw new Error(
        'reject needs --note: a rejection with no correction tells the next ' +
          'stage only that someone was unhappy',
      )
    }
    return `Rejected. Correction from the engineer:\n\n${args.note}`
  }
  if (args.file === '' || !fileExists(args.file)) {
    throw new Error(
      `answer needs --file pointing at a readable file (got '${args.file}')`,
    )
  }
  return readText(args.file)
}

export const decideRun = async (args: TDecideArgs): Promise<number> => {
  const cfg = safeParseSettlement(() => loadConfig(args.config))
  const resolved =
    cfg.status === 'ok' ? resolveDataPaths(cfg.data, repoRoot()) : undefined
  const dbPath = args.db ?? resolved?.db ?? DEFAULT_DB
  const dataDir = resolved?.dataDir ?? '.pi-crust/data'

  const state = readRunState(dbPath, args.runId)
  if (state === undefined) {
    process.stderr.write(`no session '${args.runId}' in ${dbPath}\n`)
    return EXIT.USAGE
  }
  if (state.status !== 'waiting') {
    process.stderr.write(
      `run '${args.runId}' is ${state.status}, not waiting for anyone. ` +
        'Nothing to answer.\n',
    )
    return EXIT.USAGE
  }

  const runDir = resolveRunDirectory({
    dbPath,
    sessionsDir: sessionsDirIn(dataDir),
  })(args.runId)
  const handoff = handoffDirFor(runDir)
  writeText(join(handoff, ANSWER_FILENAME), `${answerText(args).trim()}\n`)
  writeText(
    join(handoff, ANSWER_RECORD_FILENAME),
    `${JSON.stringify({
      verb: args.verb,
      at: new Date().toISOString(),
      from: engineerName(),
    })}\n`,
  )

  writeLine(
    box(
      'recorded',
      [
        `${paint('run:', 'bold')} ${args.runId}`,
        `${paint('answer:', 'bold')} ${args.verb}`,
        `${paint('written:', 'bold')} ${join(handoff, ANSWER_FILENAME)}`,
      ],
      'green',
    ),
  )
  /*
   * Carry on, rather than handing back homework.
   *
   * Approve, reject and answer all MEAN "continue" — nobody types `approve`
   * intending to then be told a second command. This used to print the resume
   * line and stop, which was two actions for one intention.
   *
   * The argv comes from the run's own `invocation.json`, so the flags it was
   * launched with survive: a gate requested with `--approve-after plan` is a
   * property of the invocation and is recorded nowhere else.
   */
  const resumed = resumeRecordedRun(
    runDir,
    args.detach ? 'detached' : 'attached',
  )
  if (!resumed.started) {
    writeLine(
      `\n${paint('could not resume automatically:', 'bold')} ${resumed.reason}`,
    )
    return EXIT.SUCCESS
  }
  writeLine(`\n${paint('resuming:', 'bold')} ${resumed.command}\n`)

  /*
   * Attached: this process now exists to carry the run's exit code, so that a
   * resumed run that fails fails the command that resumed it. Returning
   * SUCCESS here while the child was still working is what made `approve`
   * look like it had finished when it had barely started.
   */
  if (resumed.finished === undefined) return EXIT.SUCCESS
  return await resumed.finished
}
