#!/usr/bin/env bun
/**
 * pi-crust Report — where did a run get to, and what do I run to finish it?
 *
 * Usage:
 *     just crust report [<run-id>] [--json] [--db <path>] [--config <path>]
 *
 * `CRUST_DB` and `CRUST_CONFIG` stand in for the two path flags when they are
 * not passed, so the runtime honours the same variables the visualizer does.
 *
 * No run-id means the most recent session. `--json` emits TRunState verbatim,
 * which is the contract an agent parses — see references/observability.md.
 *
 * Exit codes, because something will branch on them:
 *     0  the run succeeded
 *     1  it failed
 *     2  no such session, or a usage error
 *     3  it is waiting for a person
 *     4  it is still running
 *
 * `3` and `4` exist because the old set conflated them with failure. A report
 * on a healthy in-flight run exited 1, so `just crust report` printed `recipe
 * failed` over a run that was going fine, which is how people learn to ignore
 * a red line.
 *
 * This reads the SAME function `--resume` reads (`readRunState`), so the two
 * can never disagree about which activityRuns are already done.
 */

import { dirname, join } from 'node:path'
import {
  errorMessage,
  safeParseSettlement,
} from '../lib/typedefs/src/settlement'
import { configPathFromEnv, dbPathFromEnv } from './modules/data/env-overrides'
import { box, paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH, DEFAULT_DB } from './modules/typedefs/config'
import type { TGateOutcome, TRunState } from './modules/typedefs/run-state'
import { EXIT } from './modules/typedefs/run-state'
import { renderWarnings } from './modules/typedefs/warning'
import { loadConfig } from './modules/use-cases/load-config'
import { readRunState } from './modules/use-cases/read-run-state'
import {
  RUN_RECIPE,
  recipeArgv,
  shellLine,
} from './modules/use-cases/recipe-line'
import { recordedInvocation, resumeArgv } from './modules/use-cases/resume-run'
import { displayLabel } from './modules/use-cases/run-label'

export type TReportArgs = Readonly<{
  runId: string | undefined
  json: boolean
  db: string | undefined
  config: string
}>

export const USAGE =
  'usage: just crust report [<run-id>] [--json] [--db <path>] ' +
  '[--config <path>]\n' +
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.'

const VALUE_FLAGS = ['--db', '--config'] as const

type TScan = Readonly<{
  flags: ReadonlyMap<string, string>
  positional: readonly string[]
  json: boolean
}>

export const parseReportArgs = (argv: readonly string[]): TReportArgs => {
  const read = (index: number, so_far: TScan): TScan => {
    if (index >= argv.length) {
      return so_far
    }
    const token = argv[index] ?? ''
    if (token === '--json') {
      return read(index + 1, { ...so_far, json: true })
    }
    const matched = VALUE_FLAGS.find(
      (flag) => token === flag || token.startsWith(`${flag}=`),
    )
    if (matched === undefined) {
      return read(index + 1, {
        ...so_far,
        positional: [...so_far.positional, token],
      })
    }
    const inline = token.includes('=')
      ? token.slice(token.indexOf('=') + 1)
      : undefined
    const value = inline ?? argv[index + 1]
    if (value === undefined) {
      throw new Error(`${matched} needs a value\n${USAGE}`)
    }
    return read(index + (inline === undefined ? 2 : 1), {
      ...so_far,
      flags: new Map([...so_far.flags, [matched, value]]),
    })
  }
  const { flags, positional, json } = read(0, {
    flags: new Map(),
    positional: [],
    json: false,
  })
  return {
    runId: positional[0],
    json,
    db: flags.get('--db') ?? dbPathFromEnv(),
    config: flags.get('--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH,
  }
}

/** `--db` or `CRUST_DB` wins; else the config's observability.db; else the default. */
export const resolveDbPath = (args: TReportArgs): string => {
  if (args.db !== undefined) {
    return args.db
  }
  const cfg = safeParseSettlement(() => loadConfig(args.config))
  return cfg.status === 'ok' ? cfg.data.observability.db : DEFAULT_DB
}

const MARKS: Readonly<Record<string, string>> = {
  success: '✓',
  fail: '✗',
  running: '·',
  queued: '·',
}

const gateLines = (gate: TGateOutcome): readonly string[] => [
  paint(`    gate ${gate.gate} failed`, 'red'),
  ...gate.violations.map((violation) => `      - ${violation}`),
]

/**
 * The command that picks this run back up, in the words the developer types.
 *
 * Read from what the run RECORDED, not reconstructed from the session row.
 * The row holds the entry point's own name and nothing else, so a line built
 * from it drops `--lifecycle sdlc`, `--approve-after plan` and every other
 * flag the run was started with — and the resulting command either refuses
 * for want of a chain or quietly runs a different one.
 */
export const resumeCommand = (
  state: TRunState,
  invocation: readonly string[] | undefined,
): string => {
  // `resumeArgv` answers script-first; `recipeArgv` reads a full `bun <script>`
  // line, which is the shape everything else records.
  const resumed =
    invocation === undefined
      ? undefined
      : recipeArgv(['bun', ...resumeArgv(invocation, state.run_id)])
  if (resumed !== undefined) {
    return shellLine(resumed)
  }
  const request = state.request.split('\n')[0] ?? ''

  return shellLine([
    'just',
    'crust',
    RUN_RECIPE,
    request,
    '--run-id',
    state.run_id,
    '--resume',
  ])
}

/** Where this run wrote down how it was started, from the trace it is in. */
export const sessionDirOf = (dbPath: string, runId: string): string =>
  join(dirname(dbPath), 'sessions', runId)

export const renderReport = (
  state: TRunState,
  invocation: readonly string[] | undefined = undefined,
): string => {
  const header = [
    `${paint('run_id:', 'bold')} ${state.run_id}`,
    `${paint('workflow:', 'bold')} ${displayLabel(state.name, state.lifecycle || '(unknown)')}`,
    /*
     * A name shown instead of the lifecycle still leaves the lifecycle
     * discoverable — the data stays in `sessions.lifecycle`, this just
     * prints it one line down rather than letting it hide behind the label.
     */
    ...(state.name
      ? [`${paint('lifecycle:', 'bold')} ${state.lifecycle || '(unknown)'}`]
      : []),
    `${paint('status:', 'bold')} ${state.status}`,
    `${paint('engineer:', 'bold')} ${state.engineer}`,
    `${paint('tokens:', 'bold')} ${state.tokens.toLocaleString('en-US')}` +
      `   ${paint('cost:', 'bold')} $${state.cost.toFixed(4)}`,
  ]
  const activityRuns = state.activityRuns.flatMap((activityRun) => [
    `  ${MARKS[activityRun.status] ?? '·'} ${activityRun.seq.toString().padStart(2, '0')} ` +
      `${activityRun.name.padEnd(16)} ${activityRun.kind.padEnd(9)} ${activityRun.owner.padEnd(12)}` +
      ` ${activityRun.status}`,
    ...(activityRun.error ? [paint(`      ${activityRun.error}`, 'red')] : []),
    ...activityRun.gates.filter((gate) => !gate.passed).flatMap(gateLines),
  ])
  /*
   * Keyed on `resumable`, not on `resume_from === undefined`: a run that died
   * between Activities has no row for the ones it never reached, so
   * `resume_from` alone would print the green line over a `status: fail`
   * header — the same disagreement `--resume` used to make with this report.
   */
  const tail = state.resumable
    ? state.resume_from === undefined
      ? [
          `  ${resumeCommand(state, invocation)}`,
          paint(
            'the run did not finish, even though every activity run it recorded was green',
            'yellow',
          ),
        ]
      : [
          `${paint('resume from:', 'bold')} ${state.resume_from}`,
          `  ${resumeCommand(state, invocation)}`,
        ]
    : [paint('every activity run succeeded — nothing to resume', 'green')]
  /*
   * What the run saw and could not attribute, reported here as well as in the
   * terminal that ran it. A developer asking a finished run what happened is
   * usually not the person who watched it happen.
   */
  const warnings = renderWarnings(state.warnings)

  return [
    box('run', header, state.resumable ? 'yellow' : 'green'),
    '',
    ...(activityRuns.length > 0
      ? activityRuns
      : ['  (no activityRuns recorded)']),
    '',
    ...(warnings.length > 0
      ? [...warnings.map((line) => paint(line, 'yellow')), '']
      : []),
    ...tail,
  ].join('\n')
}

export const main = (argv: readonly string[]): number => {
  const args = parseReportArgs(argv)
  const dbPath = resolveDbPath(args)
  const state = readRunState(dbPath, args.runId)
  if (state === undefined) {
    process.stderr.write(
      `no session found in ${dbPath}` +
        `${args.runId ? ` for run_id '${args.runId}'` : ''}\n${USAGE}\n`,
    )
    return EXIT.USAGE
  }
  writeLine(
    args.json
      ? JSON.stringify(state, null, 2)
      : renderReport(
          state,
          recordedInvocation(sessionDirOf(dbPath, state.run_id))?.argv,
        ),
  )
  if (state.status === 'waiting') {
    return EXIT.WAITING
  }
  if (state.status === 'running') {
    return EXIT.RUNNING
  }
  return state.status === 'success' && state.resume_from === undefined
    ? EXIT.SUCCESS
    : EXIT.FAILED
}

/** A rejection from `main` is a usage error, reported the same way other CLI entries do. */
export const reportUsageError = (error: unknown): number => {
  process.stderr.write(`${errorMessage(error)}\n${USAGE}\n`)
  return EXIT.USAGE
}

if (import.meta.main) {
  // biome-ignore lint/plugin/no-intermediate-try-catch: this is the process boundary itself \u2014 there is no settlement layer above it to hand the error to
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    process.exit(reportUsageError(error))
  }
}
