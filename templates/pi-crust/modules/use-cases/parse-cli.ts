/**
 * The workflow CLI: one positional prompt plus a handful of flags.
 *
 * Deliberately tiny and hand-rolled. A CLI framework would be a dependency in
 * every repository this tree is stamped into, to parse four flags.
 */

import { configPathFromEnv } from '../data/env-overrides'
import { DEFAULT_CONFIG_PATH } from '../typedefs/config'
import { errorMessage, safeParseSettlement } from '../typedefs/settlement'

export type TCliArgs = Readonly<{
  /** inline text or a path to a prompt file */
  prompt: string
  config: string
  runId: string | undefined
  /** `prompt.ts` only: which agent answers */
  agent: string | undefined
  /**
   * What the judging steps judge: a ref, a range, a directory, or a glob.
   *
   * `--scope` is the name, because a directory is not a base of anything.
   * `--base` remains an alias: it meant a ref long before paths were allowed,
   * and every script and habit that uses it must keep working.
   */
  base: string | undefined
  /** skip phases already recorded successful for this run_id */
  resume: boolean
  /** `compose.ts` only: the ordered step list, comma-separated */
  steps: string | undefined
  /**
   * Stages after which the run stops and waits for you, comma-separated.
   *
   * Opt-in, never opt-out: a run with no flag behaves exactly as it did
   * before. `--approve-after` rather than `--gate`, because a gate does not
   * say which side of the stage it falls on — the named stage RUNS, and the
   * chain stops before the next one begins.
   */
  approveAfter: string | undefined
  /**
   * `commit` only: 'branch' (default), 'patch', or 'commit'.
   *
   * The default signs nothing. An unattended run that commits as you puts
   * your name on work no human read, and the signing prompt it needs is the
   * thing most likely to kill the run at the last step.
   */
  deliver: string | undefined
  /**
   * Echo each agent's thinking and prose to the terminal as it arrives.
   *
   * Off by default. An unattended run that prints a model's reasoning buries
   * the one line that said what went wrong; a developer watching a run wants
   * exactly the opposite.
   */
  stream: boolean
  /**
   * How much the agents may decide for themselves, 0–100 in tens.
   *
   * `CRUST_TRUST_LEVEL` stands in when the flag is absent. A raised dial lets
   * a stage answer its own reversible questions instead of stopping the run,
   * and every such answer is reported at the end.
   */
  trustLevel: string | undefined
}>

const FLAGS = [
  '--config',
  '--run-id',
  '--agent',
  '--base',
  '--scope',
  '--steps',
  '--approve-after',
  '--deliver',
  '--trust-level',
] as const

// Flags that take NO value. The parser assumes every flag is followed by its
// value, so a boolean one listed above would swallow the prompt — and the
// failure reads as "a prompt is required" rather than as a parsing bug.
const BOOLEAN_FLAGS = ['--resume', '--stream'] as const

const usage = (script: string): string =>
  `usage: bun ${script} "<prompt or path/to/prompt.md>" ` +
  '[--config <path>] [--run-id <id>] [--agent <name>] ' +
  '[--scope <ref|range|path|glob>] ' +
  '[--steps plan,build,verify] [--approve-after identify,design] ' +
  '[--resume]\n' +
  'env: CRUST_CONFIG overrides the config path; --config still wins.'

export const parseCli = (
  argv: readonly string[],
  script = '.pi-crust/stages/<name>.ts',
): TCliArgs => {
  type TParsed = Readonly<{
    flags: ReadonlyMap<string, string>
    positional: readonly string[]
    booleans: ReadonlySet<string>
  }>

  const read = (index: number, so_far: TParsed): TParsed => {
    if (index >= argv.length) {
      return so_far
    }
    const token = argv[index] ?? ''
    const flag = BOOLEAN_FLAGS.find((candidate) => token === candidate)
    if (flag !== undefined) {
      return read(index + 1, {
        ...so_far,
        booleans: new Set([...so_far.booleans, flag]),
      })
    }
    const matched = FLAGS.find(
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
      throw new Error(`${matched} needs a value\n${usage(script)}`)
    }
    return read(index + (inline === undefined ? 2 : 1), {
      ...so_far,
      flags: new Map([...so_far.flags, [matched, value]]),
    })
  }
  const { flags, positional, booleans } = read(0, {
    flags: new Map(),
    positional: [],
    booleans: new Set(),
  })

  const prompt = positional[0]
  if (prompt === undefined || prompt === '') {
    throw new Error(`a prompt is required\n${usage(script)}`)
  }

  return {
    prompt,
    config: flags.get('--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH,
    runId: flags.get('--run-id'),
    agent: flags.get('--agent'),
    base: flags.get('--scope') ?? flags.get('--base'),
    resume: booleans.has('--resume'),
    steps: flags.get('--steps'),
    approveAfter: flags.get('--approve-after'),
    deliver: flags.get('--deliver'),
    stream: booleans.has('--stream'),
    trustLevel: flags.get('--trust-level'),
  }
}

/**
 * What every workflow's `main` takes: the CLI, with the prompt resolved.
 *
 * One object rather than four loose parameters — `prompt`, `config`, `runId`,
 * `agent`, `base`, `resume` and `steps` is past the four-param rule, and a
 * positional list that long is where a caller silently passes `config` as
 * `runId`.
 */
export type TWorkflowArgs = TCliArgs

/** Parsed args with the prompt resolved from a file when it names one. */
export const workflowArgs = (
  args: TCliArgs,
  prompt: string,
): TWorkflowArgs => ({ ...args, prompt })

/**
 * The entry boundary every workflow shares: parse, run, report, exit.
 *
 * This is where a throw becomes an exit code and a readable line on stderr.
 * Nothing below it catches, so a failure anywhere in the run arrives here.
 */
export const runCli = async (
  script: string,
  handler: (args: TCliArgs) => Promise<number>,
): Promise<never> => {
  const parsed = safeParseSettlement(() =>
    parseCli(process.argv.slice(2), script),
  )
  if (parsed.status === 'error') {
    process.stderr.write(`${parsed.error.message}\n`)
    return process.exit(2)
  }
  const code = await handler(parsed.data).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`)
    return 1
  })
  return process.exit(code)
}
