/**
 * The workflow CLI: one positional prompt plus a handful of flags.
 *
 * Deliberately tiny and hand-rolled. A CLI framework would be a dependency in
 * every repository this tree is stamped into, to parse four flags.
 */

import { errorMessage, safeParseSettlement } from '../../../../../lib/typedefs'
import { DEFAULT_CONFIG_PATH } from '../../../../lib/contracts'
import { configPathFromEnv } from '../../../../lib/system'
import { RUN_RECIPE } from './recipe-line'
import { runName } from './run-label'

export type TCliArgs = Readonly<{
  /** inline text or a path to a prompt file */
  prompt: string
  config: string
  runId: string | undefined
  /**
   * What the judging activities judge: a ref, a range, a directory, or a glob.
   *
   * `--scope` is the name, because a directory is not a base of anything.
   * `--base` remains an alias: it meant a ref long before paths were allowed,
   * and every script and habit that uses it must keep working.
   */
  base: string | undefined
  /** skip activityRuns already recorded successful for this run_id */
  resume: boolean
  /**
   * The Composer only: the chain, as Stages.
   *
   * `,` ends a Stage and `+` joins Activities into one concurrent Stage, so
   * `plan,build,review+code-review` is three Stages, the last of which runs
   * two Activities at once. See `parse-activities.ts` for the whole grammar.
   */
  activities: string | undefined
  /** `compose.ts` only: a Lifecycle by name, from crust.lifecycles.yaml */
  lifecycle: string | undefined
  /** Per-activity model and thinking overrides, for this run only. */
  models: string | undefined
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
   * `--commit false`, and nothing else.
   *
   * Delivery is a property of each Activity: one that declares
   * `commit: true` lands its own change once its gates pass. This flag only
   * SUBTRACTS — there is no `--commit true`, because a flag granting a
   * permission the registry withheld would make a run behave in a way
   * nobody reading the registry could predict.
   *
   * It takes a value rather than being a bare switch, so it joins the
   * value-flag list; a bare flag would consume the prompt as its value.
   */
  commit: string | undefined
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
  /**
   * Where this run's handoff documents go.
   *
   * `{session_id}` (or `{run_id}`, an exact synonym) expands to the run id.
   * A relative value resolves against the repository root. Absent, the
   * directory is exactly what it has always been:
   * `<data_dir>/sessions/<run_id>/context_handoff`.
   */
  handoff: string | undefined
  /**
   * A human label for this run, shown instead of the lifecycle name on the
   * report, the `please` picker, and the visualizer's session card.
   */
  name: string | undefined
}>

/**
 * The flag that was replaced, refused by name.
 *
 * Not an alias: `--steps` could only ever mean one serial Stage, and a flag
 * that silently kept working would keep a developer believing a concurrent
 * group is what they asked for. Not silence either — an unknown flag would
 * be swallowed as the prompt, and the run would start on the wrong thing.
 * So: refused, naming its replacement, and the run does not start.
 */
const REMOVED_FLAG = '--steps'

export const REMOVED_FLAG_MESSAGE =
  '--steps was removed. Use --activities; a concurrent Stage is written a+b.'

/**
 * One flag, in one place: its canonical long name, its optional short alias,
 * and whether the parser consumes the next token as its value.
 *
 * This replaces two parallel arrays (`FLAGS` and `BOOLEAN_FLAGS`) that used
 * to drift from the usage line and from each other — a short name could live
 * here and be missing from `usage` until somebody typed it and got refused
 * for a flag that looked documented. Everything derived below reads this
 * table instead of repeating it.
 */
export type TFlagSpec = Readonly<{
  /** the canonical name — the only one anything past `read` ever sees */
  long: string
  /** the single-dash alias, absent for flags nobody types in a hurry */
  short?: string
  /** true when the parser consumes the next token as this flag's value */
  takesValue: boolean
}>

export const FLAG_TABLE: readonly TFlagSpec[] = [
  { long: '--config', takesValue: true },
  { long: '--run-id', short: '-id', takesValue: true },
  { long: '--base', takesValue: true },
  { long: '--scope', takesValue: true },
  { long: '--activities', short: '-a', takesValue: true },
  { long: '--lifecycle', short: '-l', takesValue: true },
  { long: '--model', short: '-m', takesValue: true },
  { long: '--approve-after', takesValue: true },
  /*
   * `-c` is `--commit`'s letter, not `--config`'s: `--commit` takes exactly
   * one value (`false`), so `-c false` is unambiguous, and `--config` can
   * never have this letter as a result.
   */
  { long: '--commit', short: '-c', takesValue: true },
  { long: '--trust-level', takesValue: true },
  { long: '--handoff', takesValue: true },
  { long: '--name', short: '-n', takesValue: true },
  { long: '--resume', short: '-r', takesValue: false },
  { long: '--stream', takesValue: false },
]

const FLAGS = FLAG_TABLE.filter((flag) => flag.takesValue).map(
  (flag) => flag.long,
)

// Flags that take NO value. The parser assumes every flag is followed by its
// value, so a boolean one listed above would swallow the prompt — and the
// failure reads as "a prompt is required" rather than as a parsing bug.
const BOOLEAN_FLAGS = FLAG_TABLE.filter((flag) => !flag.takesValue).map(
  (flag) => flag.long,
)

/**
 * `-id` is a two-letter single-dash token, not a cluster — it is unambiguous
 * only because flag clustering is refused. Adding `-ra`-style clustering
 * later would silently turn `-id` into `-i -d`; this map, and the guard in
 * `read`, both assume clustering stays out of scope.
 */
const LONG_OF: ReadonlyMap<string, string> = new Map(
  FLAG_TABLE.flatMap((flag) =>
    flag.short === undefined ? [] : [[flag.short, flag.long] as const],
  ),
)

const usage = (recipe: string): string =>
  `usage: just crust ${recipe} "<prompt or path/to/prompt.md>" ` +
  '<--lifecycle sdlc | --activities plan,build,review+code-review>\n' +
  '  `just crust list` prints the Lifecycles and Activities this repo offers.\n' +
  '  optional: [--config <path>] [--run-id <id>] [--commit false] ' +
  '[--scope <ref|range|path|glob>] [--approve-after identify,design] ' +
  '[--model <activity>=<model>@<thinking>,...] ' +
  '[--trust-level 50] [--stream] [--resume] ' +
  '[--handoff <path/{session_id}>] [--name <label>]\n' +
  '  short: ' +
  FLAG_TABLE.filter((flag) => flag.short !== undefined)
    .map((flag) => `${flag.short} ${flag.long}`)
    .join(', ') +
  '\n' +
  'env: CRUST_CONFIG overrides the config path; --config still wins.'

/**
 * argv with every short flag rewritten to its long name; values untouched.
 *
 * Walks left to right, rewrites a token that is exactly a short name or
 * starts with `<short>=`, and skips the token after a value-taking flag so a
 * value is never mistaken for a flag.
 */
export const longFlagArgv = (argv: readonly string[]): readonly string[] => {
  const rewrite = (token: string): string => {
    const name = token.includes('=')
      ? token.slice(0, token.indexOf('='))
      : token
    const long = LONG_OF.get(name)
    return long === undefined ? token : long + token.slice(name.length)
  }

  type TAcc = Readonly<{ tokens: readonly string[]; skipNext: boolean }>
  const { tokens } = argv.reduce<TAcc>(
    (acc, token) => {
      if (acc.skipNext) {
        return { tokens: [...acc.tokens, token], skipNext: false }
      }
      const rewritten = rewrite(token)
      const spec = FLAG_TABLE.find((flag) => flag.long === rewritten)
      return {
        tokens: [...acc.tokens, rewritten],
        skipNext: (spec?.takesValue ?? false) && !token.includes('='),
      }
    },
    { tokens: [], skipNext: false },
  )
  return tokens
}

/**
 * `--commit` accepts one value, and it is `false`.
 *
 * `--commit true` is refused rather than accepted-and-ignored: somebody
 * typing it believes it grants something, and silence would let them believe
 * it worked. Committing is declared per Activity in the registry.
 */
export const commitFlag = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value !== 'false') {
    throw new Error(
      `--commit takes only 'false' (got '${value}'). Committing is declared ` +
        'per Activity in crust.activities.yaml; the flag can only take it ' +
        'away, never grant it.',
    )
  }

  return value
}

/**
 * `--handoff` takes a path. An empty one is refused rather than treated as
 * the default — typing the flag with nothing after it is a mistake, not a
 * request to behave as if it were absent.
 */
export const handoffFlag = (value: string | undefined): string | undefined => {
  if (value !== '') {
    return value
  }
  throw new Error(
    "--handoff takes a path (got ''). Drop the flag for the default directory.",
  )
}

/**
 * What to say about a flag this CLI does not have.
 *
 * The nearest known flag is offered when the typo is one edit away from one,
 * because the overwhelmingly common case is a plural or a missing letter and
 * naming the fix is cheaper than reading a list of nine.
 */
export const unknownFlag = (token: string, recipe: string): string => {
  const given = token.split('=')[0] ?? token
  const near = [...FLAGS, ...BOOLEAN_FLAGS, ...LONG_OF.keys()].find(
    (flag) =>
      flag.startsWith(given) ||
      given.startsWith(flag) ||
      `${flag}s` === given ||
      flag === `${given}s`,
  )

  return (
    `unknown flag: ${given}` +
    (near === undefined ? '' : ` — did you mean ${near}?`) +
    `\n${usage(recipe)}`
  )
}

export const parseCli = (
  argv: readonly string[],
  recipe = RUN_RECIPE,
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
    const raw = argv[index] ?? ''
    // A short alias is resolved to its long name before anything else runs,
    // so the removed-flag check, the switch match and the value-flag match
    // all see only long names — nothing past this point knows a short one
    // was typed.
    const name = raw.includes('=') ? raw.slice(0, raw.indexOf('=')) : raw
    const long = LONG_OF.get(name)
    const token = long === undefined ? raw : long + raw.slice(name.length)
    const flag = BOOLEAN_FLAGS.find((candidate) => token === candidate)
    if (flag !== undefined) {
      return read(index + 1, {
        ...so_far,
        booleans: new Set([...so_far.booleans, flag]),
      })
    }
    if (token === REMOVED_FLAG || token.startsWith(`${REMOVED_FLAG}=`)) {
      throw new Error(REMOVED_FLAG_MESSAGE)
    }
    const matched = FLAGS.find(
      (flag) => token === flag || token.startsWith(`${flag}=`),
    )
    if (matched === undefined) {
      /*
       * A flag nobody recognises is refused rather than read as the prompt.
       *
       * It used to fall through to the positional list, where it was either
       * swallowed whole or, worse, became the prompt: `--lifecycles sdlc`
       * (one letter wrong) left `--lifecycle` unset and the run failed
       * complaining that `--activities` was required, which is a true
       * sentence about the wrong problem. A typo in a flag has to say so.
       *
       * A single-dash token used to fall through the same way, so
       * `-l sdlc "add a /health endpoint"` made `-l` the prompt before short
       * aliases existed to resolve it — the guard now refuses ANY leading
       * dash it did not recognise, not only `--`.
       */
      if (token.startsWith('-')) {
        throw new Error(unknownFlag(token, recipe))
      }
      return read(index + 1, {
        ...so_far,
        positional: [...so_far.positional, token],
      })
    }
    if (matched === '--model' && so_far.flags.has(matched)) {
      throw new Error(
        '--model was given more than once — combine the entries into one comma-separated list, e.g. --model build=openai/gpt-5,test=@high',
      )
    }
    const inline = token.includes('=')
      ? token.slice(token.indexOf('=') + 1)
      : undefined
    const value = inline ?? argv[index + 1]
    if (value === undefined) {
      throw new Error(`${matched} needs a value\n${usage(recipe)}`)
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
    throw new Error(`a prompt is required\n${usage(recipe)}`)
  }

  return {
    prompt,
    config: flags.get('--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH,
    runId: flags.get('--run-id'),
    base: flags.get('--scope') ?? flags.get('--base'),
    resume: booleans.has('--resume'),
    activities: flags.get('--activities'),
    lifecycle: flags.get('--lifecycle'),
    models: flags.get('--model'),
    approveAfter: flags.get('--approve-after'),
    commit: commitFlag(flags.get('--commit')),
    stream: booleans.has('--stream'),
    trustLevel: flags.get('--trust-level'),
    handoff: handoffFlag(flags.get('--handoff')),
    name: runName(flags.get('--name')),
  }
}

/**
 * What every workflow's `main` takes: the CLI, with the prompt resolved.
 *
 * One object rather than four loose parameters — `prompt`, `config`, `runId`,
 * `base`, `resume` and `activities` is past the four-param rule, and a
 * positional list that long is where a caller silently passes `config` as
 * `runId`.
 */
export type TWorkflowArgs = TCliArgs & Readonly<{ promptPath?: string }>

/** Parsed args with the prompt resolved from a file when it names one. */
export const workflowArgs = (
  args: TCliArgs,
  prompt: string,
): TWorkflowArgs => ({
  ...args,
  prompt,
  ...(prompt === args.prompt ? {} : { promptPath: args.prompt }),
})

/**
 * The entry boundary every workflow shares: parse, run, report, exit.
 *
 * This is where a throw becomes an exit code and a readable line on stderr.
 * Nothing below it catches, so a failure anywhere in the run arrives here.
 */
export const runCli = async (
  recipe: string,
  handler: (args: TCliArgs) => Promise<number>,
): Promise<never> => {
  const parsed = safeParseSettlement(() =>
    parseCli(process.argv.slice(2), recipe),
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
