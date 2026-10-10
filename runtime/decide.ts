#!/usr/bin/env bun
/**
 * pi-crust Decide — answer a run that is waiting for you.
 *
 * Usage:
 *     bun .pi-crust/decide.ts approve <run-id>
 *     bun .pi-crust/decide.ts reject  <run-id> --note "what to change"
 *     bun .pi-crust/decide.ts answer  <run-id> --file answers.md
 *
 * A gated run exits rather than blocking, so this is how the answer gets back
 * to it. It writes the answer into the session's handoff directory and tells
 * you the one command that picks the run up — it does NOT resume by itself.
 * Resuming can cost real money, and a command whose name is `approve` should
 * not also spend it.
 *
 * The answer becomes a FACT in the next stage's context, attributed to you.
 * A later stage reading "the retention window is 90 days" should be able to
 * tell that a person said so rather than that an agent inferred it.
 *
 * Exit codes: 0 recorded, 2 usage or no such waiting run.
 */

import { join } from 'node:path'
import { fileExists, readText, writeText } from './modules/data/files'
import { box, paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH, DEFAULT_DB } from './modules/typedefs/config'
import { EXIT } from './modules/typedefs/run-state'
import {
  errorMessage,
  safeParseSettlement,
} from './modules/typedefs/settlement'
import { configPathFromEnv, dbPathFromEnv } from './modules/data/env-overrides'
import { ANSWER_FILENAME } from './modules/use-cases/human-gate'
import { resumeRecordedRun } from './modules/use-cases/resume-run'
import { loadConfig } from './modules/use-cases/load-config'
import { readRunState } from './modules/use-cases/read-run-state'

export const USAGE =
  'usage: bun .pi-crust/decide.ts <approve|reject|answer> <run-id> ' +
  '[--note "..."] [--file <path>]\n' +
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.'

export const VERBS = ['approve', 'reject', 'answer'] as const
export type TVerb = (typeof VERBS)[number]

export const isVerb = (value: string): value is TVerb =>
  (VERBS as readonly string[]).includes(value)

export type TDecideArgs = Readonly<{
  verb: TVerb
  runId: string
  note: string
  file: string
  db: string | undefined
  config: string
  /**
   * Hand the terminal back instead of following the run you just resumed.
   *
   * The default is to stay, because answering a gate and starting a run are
   * the same act and should not feel different. This is for the case where
   * you answer one gate and want to go and answer another.
   */
  detach: boolean
}>

export const parseDecideArgs = (argv: readonly string[]): TDecideArgs => {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const positional = argv.filter(
    (token, index) =>
      !(token.startsWith('--') || (argv[index - 1] ?? '').startsWith('--')),
  )
  const [verb, runId] = positional
  if (verb === undefined || !isVerb(verb)) {
    throw new Error(`first argument must be one of ${VERBS.join(', ')}`)
  }
  if (runId === undefined || runId === '') {
    throw new Error('an run-id is required')
  }
  return {
    verb,
    runId,
    note: flag('--note') ?? '',
    file: flag('--file') ?? '',
    db: flag('--db') ?? dbPathFromEnv(),
    config: flag('--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH,
    detach: argv.includes('--detach'),
  }
}

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

export const main = async (argv: readonly string[]): Promise<number> => {
  const args = parseDecideArgs(argv)
  const cfg = safeParseSettlement(() => loadConfig(args.config))
  const dbPath =
    args.db ?? (cfg.status === 'ok' ? cfg.data.observability.db : DEFAULT_DB)
  const dataDir =
    cfg.status === 'ok' ? cfg.data.defaults.data_dir : '.pi-crust/data'

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

  const handoff = join(dataDir, 'sessions', args.runId, 'context_handoff')
  writeText(join(handoff, ANSWER_FILENAME), `${answerText(args).trim()}\n`)

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
    join(dataDir, 'sessions', args.runId),
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

if (import.meta.main) {
  /*
   * `main` now waits for the run it resumed, so its failures are rejections
   * rather than throws and a synchronous settlement would never see them.
   * Same shape as `runCli`: parse errors are usage, everything else carries
   * the resumed run's own exit code out.
   */
  const code = await main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n${USAGE}\n`)
    return EXIT.USAGE
  })
  process.exit(code)
}
