import { join } from 'node:path'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { DEFAULT_CONFIG_PATH, DEFAULT_DB } from '../../../../lib/contracts'
import { configPathFromEnv, dbPathFromEnv } from '../../../../lib/system'
import { loadConfig } from '../../../config'
import { repoRoot, resolveDataPaths } from '../../../workspace'
import { sessionDirOf } from './resume-run'

export type TReportArgs = Readonly<{
  runId: string | undefined
  json: boolean
  db: string | undefined
  config: string
}>

export const REPORT_USAGE =
  'usage: just crust report [<run-id>] [--json] [--db <path>] ' +
  '[--config <path>]\n' +
  'env: CRUST_DB and CRUST_CONFIG override the paths; the flags still win.'

export const VALUE_FLAGS = ['--db', '--config'] as const

export type TScan = Readonly<{
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
      throw new Error(`${matched} needs a value\n${REPORT_USAGE}`)
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

/** `--db` or `CRUST_DB` wins; else the crust.db inside defaults.data_dir; else the default. */
export const resolveDbPath = (args: TReportArgs): string => {
  if (args.db !== undefined) {
    return args.db
  }
  const cfg = safeParseSettlement(() => loadConfig(args.config))
  return cfg.status === 'ok'
    ? resolveDataPaths(cfg.data, repoRoot()).db
    : DEFAULT_DB
}

export const resolveSessionDir = (
  args: TReportArgs,
  dbPath: string,
  runId: string,
): string => {
  const cfg = safeParseSettlement(() => loadConfig(args.config))
  return cfg.status === 'ok'
    ? join(resolveDataPaths(cfg.data, repoRoot()).dataDir, 'sessions', runId)
    : sessionDirOf(dbPath, runId)
}
