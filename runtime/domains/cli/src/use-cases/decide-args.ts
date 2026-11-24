import { DEFAULT_CONFIG_PATH } from '../../../../lib/contracts'
import { configPathFromEnv, dbPathFromEnv } from '../../../../lib/system'
import { DECIDE_CLI, positionalArgs } from '../..'

export const DECIDE_USAGE =
  'usage: crust <approve|reject|answer> <run-id> ' +
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
  const positional = positionalArgs(argv, DECIDE_CLI)
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
