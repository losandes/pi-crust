#!/usr/bin/env bun
/**
 * pi-crust Report — where did a run get to, and what do I run to finish it?
 *
 * Usage:
 *     bun .pi-crust/report.ts [<run-id>] [--json] [--db <path>] [--config <path>]
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
 * can never disagree about which phases are already done.
 */

import { isStepName } from './modules/typedefs/step'
import { configPathFromEnv, dbPathFromEnv } from './modules/data/env-overrides'
import { box, paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH, DEFAULT_DB } from './modules/typedefs/config'
import { EXIT } from './modules/typedefs/run-state'
import type { TGateOutcome, TRunState } from './modules/typedefs/run-state'
import {
  errorMessage,
  safeParseSettlement,
} from './modules/typedefs/settlement'
import { loadConfig } from './modules/use-cases/load-config'
import { readRunState } from './modules/use-cases/read-run-state'

export type TReportArgs = Readonly<{
  runId: string | undefined
  json: boolean
  db: string | undefined
  config: string
}>

export const USAGE =
  'usage: bun .pi-crust/report.ts [<run-id>] [--json] [--db <path>] ' +
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
  paint(`    gate ${gate.gate} failed (attempt ${gate.attempt})`, 'red'),
  ...gate.violations.map((violation) => `      - ${violation}`),
]

/**
 * The command that picks this run back up, in the words the developer types.
 *
 * A single stage and a whole lifecycle live in different directories, so the
 * name decides the path: anything in the step registry is a stage, everything
 * else is a lifecycle. Guessing one directory would print a command that does
 * not exist, for exactly the runs a developer is already frustrated by.
 */
export const resumeCommand = (state: TRunState): string => {
  const workflow = (state.lifecycle.split(' + ').at(-1) || 'sdlc').trim()
  const folder = isStepName(workflow) ? 'stages' : 'lifecycles'
  const request = state.request.replaceAll('"', '\\"').split('\n')[0] ?? ''
  return (
    `bun .pi-crust/${folder}/${workflow}.ts --run-id ${state.run_id} --resume ` +
    `"${request}"`
  )
}

export const renderReport = (state: TRunState): string => {
  const header = [
    `${paint('run_id:', 'bold')} ${state.run_id}`,
    `${paint('workflow:', 'bold')} ${state.lifecycle || '(unknown)'}`,
    `${paint('status:', 'bold')} ${state.status}`,
    `${paint('engineer:', 'bold')} ${state.engineer}`,
    `${paint('tokens:', 'bold')} ${state.tokens.toLocaleString('en-US')}` +
      `   ${paint('cost:', 'bold')} $${state.cost.toFixed(4)}`,
  ]
  const phases = state.phases.flatMap((phase) => [
    `  ${MARKS[phase.status] ?? '·'} ${phase.seq.toString().padStart(2, '0')} ` +
      `${phase.name.padEnd(16)} ${phase.kind.padEnd(9)} ${phase.owner.padEnd(12)}` +
      ` ${phase.status}`,
    ...(phase.error ? [paint(`      ${phase.error}`, 'red')] : []),
    ...phase.gates.filter((gate) => !gate.passed).flatMap(gateLines),
  ])
  const tail =
    state.resume_from === undefined
      ? [paint('every phase succeeded — nothing to resume', 'green')]
      : [
          `${paint('resume from:', 'bold')} ${state.resume_from}`,
          `  ${resumeCommand(state)}`,
        ]
  return [
    box('run', header, state.resume_from === undefined ? 'green' : 'yellow'),
    '',
    ...(phases.length > 0 ? phases : ['  (no phases recorded)']),
    '',
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
  writeLine(args.json ? JSON.stringify(state, null, 2) : renderReport(state))
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

if (import.meta.main) {
  const settled = safeParseSettlement(() => main(process.argv.slice(2)))
  if (settled.status === 'error') {
    process.stderr.write(`${errorMessage(settled.error)}\n${USAGE}\n`)
    process.exit(EXIT.USAGE)
  }
  process.exit(settled.data)
}
