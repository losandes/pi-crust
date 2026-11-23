/**
 * Every `just crust` recipe, its flags, its environment variables, and a
 * worked example where one exists — transcribed, not generated.
 *
 * `runtime/commands/crust.just` carries the authoritative prose, but `just` only
 * attaches a contiguous comment block to the recipe directly beneath it, and
 * this file's own comments deliberately break that rule in places (the
 * `--handoff`/`--name` prose sits between `run` and `verify`; the `observe`
 * explanation is split either side of `update`). A parser reading `crust.just`
 * at run time would attribute those by guesswork, and half of `run`'s flags
 * — `--scope`, `--approve-after`, `--commit`, `--trust-level`, `--stream` —
 * are never named there at all; only `parse-cli.ts` knows about them. So this
 * is a hand-written table instead, and `recipe-docs.test.ts` is what keeps it
 * from going stale the way the per-Activity recipes it replaced did: it fails
 * when a recipe exists here that `crust.just` no longer declares, or the
 * other way round.
 *
 * Data and types only — no IO, nothing that reads `crust.just` itself.
 */

export type TDocLine = Readonly<{ name: string; detail: string }>

export type TRecipeGroup =
  | 'getting started'
  | 'running work'
  | 'steering a run'
  | 'reading the trace'
  | 'housekeeping'

export type TRecipeDoc = Readonly<{
  name: string
  group: TRecipeGroup
  /** one line, as `just --list` shows */
  summary: string
  /** begins `just crust <name>` */
  usage: string
  /** [] when the recipe takes none beyond the global flags */
  flags: readonly TDocLine[]
  /** [] when none beyond the global environment variables */
  env: readonly TDocLine[]
  /** full command lines, copy-pasteable */
  examples: readonly string[]
}>

export const GROUPS: readonly TRecipeGroup[] = [
  'getting started',
  'running work',
  'steering a run',
  'reading the trace',
  'housekeeping',
]

/** Flags every recipe that touches a config or a db file honours. */
export const GLOBAL_FLAGS: readonly TDocLine[] = [
  {
    name: '--config <path>',
    detail:
      'pi-crust.toml to read; most recipes pass {{config}} through automatically',
  },
  {
    name: '--db <path>',
    detail:
      'crust.db to read; the recipes under "reading the trace" and the steering recipes accept this',
  },
]

/** Environment variables that change more than one recipe's behaviour. */
export const GLOBAL_ENV: readonly TDocLine[] = [
  {
    name: 'CRUST_CONFIG',
    detail: 'overrides the config path; the --config flag still wins',
  },
  {
    name: 'CRUST_DB',
    detail: 'overrides the db path; the --db flag still wins',
  },
  {
    name: 'CRUST_HOME',
    detail:
      'where pi-crust itself is installed, for repos that stamped it; resolved from this before the stamp pointer, then the pointer beside the shared git directory',
  },
  {
    name: 'CRUST_BE_PORT',
    detail:
      'the observability API port; default 4600, overriding merged TOML settings',
  },
  {
    name: 'CRUST_FE_PORT',
    detail:
      'the observability web app port; default 4601, overriding merged TOML settings',
  },
]

export const RECIPE_DOCS: readonly TRecipeDoc[] = [
  {
    name: 'help',
    group: 'getting started',
    summary: 'every recipe, every flag, and what this repo can run',
    usage: 'just crust help [<recipe>]',
    flags: [
      {
        name: '<recipe>',
        detail: 'narrow the output to one recipe\u2019s entry',
      },
    ],
    env: [],
    examples: ['just crust help', 'just crust help run'],
  },
  {
    name: 'default',
    group: 'getting started',
    summary: 'list every crust recipe',
    usage: 'just crust default  (same as the bare `just crust`)',
    flags: [],
    env: [],
    examples: ['just crust'],
  },
  {
    name: 'demo',
    group: 'getting started',
    summary: 'start here: two cheap read-only runs, end to end',
    usage: 'just crust demo',
    flags: [],
    env: [],
    examples: ['just crust demo'],
  },
  {
    name: 'list',
    group: 'getting started',
    summary:
      'what this repository offers, read from its own configuration (the catalogue alone; help adds the recipes)',
    usage: 'just crust list [--config <path>]',
    flags: [],
    env: [],
    examples: ['just crust list'],
  },
  {
    name: 'config',
    group: 'getting started',
    summary:
      'effective TOML settings, entry models and prompt directories, with their layer and file sources',
    usage: 'just crust config [--config <path>]',
    flags: [],
    env: [],
    examples: ['just crust config'],
  },
  {
    name: 'please',
    group: 'getting started',
    summary: 'build the command by answering questions',
    usage: 'just crust please',
    flags: [],
    env: [],
    examples: ['just crust please'],
  },
  {
    name: 'run',
    group: 'running work',
    summary: 'run a Lifecycle, or any chain of Activities',
    usage:
      'just crust run "<prompt or path/to/prompt.md>" <--lifecycle <name> | --activities a,b,c>',
    flags: [
      {
        name: '--lifecycle <name> (-l)',
        detail:
          'the Lifecycle to run; the lifecycles section above lists this repository\u2019s',
      },
      {
        name: '--activities a,b,c (-a)',
        detail: '`,` ends a Stage, `a+b` runs two Activities at once',
      },
      {
        name: '--model <activity>=<model>@<thinking>,... (-m)',
        detail:
          "change an activity's model, thinking level, or both, for this run only; give the flag once",
      },
      {
        name: '--run-id <id> (-id)',
        detail: 'an existing run to add to, instead of minting one',
      },
      {
        name: '--resume (-r)',
        detail: 'continue that run where it stopped; pair it with --run-id',
      },
      {
        name: '--scope <ref|range|path|glob>',
        detail:
          'what the judging Activities judge (--base is the older name for the same flag)',
      },
      {
        name: '--approve-after a,b',
        detail:
          'stop for you after those Activities; the run exits rather than blocking',
      },
      {
        name: '--commit false (-c)',
        detail:
          'land nothing. Only `false` is accepted \u2014 committing is declared per Activity. --commit false is rejected at startup for a Lifecycle ending in a terminal Activity that requires commits',
      },
      {
        name: '--trust-level 50',
        detail: 'how much it decides for itself before stopping for you',
      },
      {
        name: '--handoff <path>',
        detail:
          'where this run\u2019s documents go; {session_id} (or {run_id}) expands to the run id',
      },
      {
        name: '--name <label> (-n)',
        detail:
          'a label shown instead of the Lifecycle on the report, in `please`, and in the visualizer',
      },
      {
        name: '--stream',
        detail:
          'echo each agent\u2019s thinking and prose to the terminal as it arrives',
      },
    ],
    env: [
      {
        name: 'CRUST_TRUST_LEVEL',
        detail: 'default for --trust-level when the flag is absent',
      },
    ],
    examples: [
      'just crust run "add a /health endpoint" --lifecycle sdlc',
      'just crust run "add a /health endpoint" --activities plan,build,review+code-review',
      'just crust run "the original request" --lifecycle sdlc --run-id 9d67c31f --resume',
      'just crust run "..." --lifecycle sdlc --handoff specs/{session_id}',
      'just crust run "..." --lifecycle deliver -m build=openai/gpt-5@high,code-review=@xhigh',
    ],
  },
  {
    name: 'operator',
    group: 'running work',
    summary: 'let it choose the chain and run it',
    usage:
      'just crust operator "<prompt or path/to/prompt.md>" [--trust-level 50] [--run-id a1b2c3d4] [--resume]',
    flags: [
      {
        name: '--trust-level 50',
        detail: 'how much it decides for itself before stopping for you',
      },
      { name: '--run-id <id>', detail: 'an existing run to add to' },
      { name: '--resume', detail: 'continue that run where it stopped' },
    ],
    env: [],
    examples: ['just crust operator "the webhook drops retries"'],
  },
  {
    name: 'triage',
    group: 'running work',
    summary: 'recommend a lifecycle instead of running it',
    usage:
      'just crust triage "<prompt or path/to/prompt.md>" [--run-id a1b2c3d4] [--resume]',
    flags: [
      { name: '--run-id <id>', detail: 'an existing run to add to' },
      { name: '--resume', detail: 'continue that run where it stopped' },
    ],
    env: [],
    examples: ['just crust triage "the webhook drops retries"'],
  },
  {
    name: 'verify',
    group: 'running work',
    summary: 'run the change tasks over what you changed',
    usage:
      'just crust verify [--scope <ref|range|path|glob>] [--config <path>]',
    flags: [
      {
        name: '--scope <ref|range|path|glob>',
        detail:
          'what to check (--base is the older name); omitted runs against changed and untracked files',
      },
    ],
    env: [],
    examples: ['just crust verify', 'just crust verify --scope apps/gateway'],
  },
  {
    name: 'approve',
    group: 'steering a run',
    summary: 'continue a run that is waiting for you',
    usage: 'just crust approve <run-id>',
    flags: [],
    env: [],
    examples: ['just crust approve 9d67c31f'],
  },
  {
    name: 'reject',
    group: 'steering a run',
    summary: 'send it back with a correction',
    usage: 'just crust reject <run-id> [--note "..."]',
    flags: [{ name: '--note "..."', detail: 'what to change' }],
    env: [],
    examples: [
      'just crust reject 9d67c31f --note "use the registry, not the map"',
    ],
  },
  {
    name: 'answer',
    group: 'steering a run',
    summary: 'answer the questions it could not',
    usage: 'just crust answer <run-id> [--file <path>]',
    flags: [
      {
        name: '--file <path>',
        detail: 'a file of answers instead of a flag value',
      },
    ],
    env: [],
    examples: ['just crust answer 9d67c31f --file a.md'],
  },
  {
    name: 'resume',
    group: 'steering a run',
    summary:
      'pick a stopped run back up, optionally with a note every activity from here reads',
    usage: 'just crust resume <run-id> [--note "what you changed"] [--detach]',
    flags: [
      {
        name: '--note "..."',
        detail:
          "a standing instruction every activity from here reads, through the run's own steering.md \u2014 not a message to a live agent",
      },
      {
        name: '--detach',
        detail: 'run in the background instead of attaching to this terminal',
      },
    ],
    env: [],
    examples: [
      'just crust resume 9d67c31f --note "I fixed the failing migration"',
    ],
  },
  {
    name: 'steer',
    group: 'steering a run',
    summary: 'send a run back to an activity with new instructions',
    usage:
      'just crust steer <run-id> <activity> <--overwrite|--branch> "instruction" [--seeding fork|fresh] [--branch-id <id>]',
    flags: [
      {
        name: '--overwrite',
        detail:
          'the steered activities rewrite their own documents; the path you are steering away from is not kept',
      },
      {
        name: '--branch',
        detail:
          'a new run, seeded from this one up to the branch point; both outcomes stay readable side by side',
      },
      {
        name: '--seeding fork|fresh',
        detail:
          '--branch only; fork (the default) copies each agent\u2019s own conversation, fresh starts over against the handoff documents',
      },
      {
        name: '--branch-id <id>',
        detail:
          '--branch only; names the branch\u2019s run id instead of minting one',
      },
    ],
    env: [],
    examples: [
      'just crust steer 9d67c31f build --overwrite "use the registry, not the map"',
      'just crust steer 9d67c31f build --branch --seeding fresh "start over"',
    ],
  },
  {
    name: 'ask',
    group: 'steering a run',
    summary:
      'ask a finished activity a question \u2014 it still remembers the conversation',
    usage: 'just crust ask <run-id> <activity> "question"',
    flags: [],
    env: [],
    examples: [
      'just crust ask 9d67c31f design "why did you choose a registry table?"',
    ],
  },
  {
    name: 'amend',
    group: 'steering a run',
    summary: 'have a finished activity revise its own document',
    usage: 'just crust amend <run-id> <activity> "what to change"',
    flags: [],
    env: [],
    examples: ['just crust amend 9d67c31f design "shorten section 3"'],
  },
  {
    name: 'join',
    group: 'steering a run',
    summary: "step into a stopped run's conversation",
    usage: 'just crust join <run-id> <activity>',
    flags: [],
    env: [],
    examples: ['just crust join 9d67c31f build'],
  },
  {
    name: 'report',
    group: 'reading the trace',
    summary: 'where a run got to, and what to run to finish it',
    usage:
      'just crust report [<run-id>] [--json] [--db <path>] [--config <path>]',
    flags: [
      {
        name: '--json',
        detail: 'emit TRunState verbatim, for an agent to parse',
      },
    ],
    env: [],
    examples: ['just crust report', 'just crust report 9d67c31f'],
  },
  {
    name: 'report-json',
    group: 'reading the trace',
    summary: 'the same, as JSON for an agent to parse',
    usage: 'just crust report-json [<run-id>] [--db <path>] [--config <path>]',
    flags: [],
    env: [],
    examples: ['just crust report-json 9d67c31f'],
  },
  {
    name: 'sessions',
    group: 'reading the trace',
    summary: 'the last 10 runs',
    usage: 'just crust sessions',
    flags: [],
    env: [],
    examples: ['just crust sessions'],
  },
  {
    name: 'activity-runs',
    group: 'reading the trace',
    summary: 'activity run status in sequence',
    usage: 'just crust activity-runs <run-id>',
    flags: [],
    env: [],
    examples: ['just crust activity-runs 9d67c31f'],
  },
  {
    name: 'tail',
    group: 'reading the trace',
    summary: 'the live event tail',
    usage: 'just crust tail <run-id>',
    flags: [],
    env: [],
    examples: ['just crust tail 9d67c31f'],
  },
  {
    name: 'procs',
    group: 'reading the trace',
    summary: 'what a run has alive right now, with pids',
    usage: 'just crust procs <run-id>',
    flags: [],
    env: [],
    examples: ['just crust procs 9d67c31f'],
  },
  {
    name: 'observe',
    group: 'reading the trace',
    summary:
      'boot the trace UI with merged TOML ports and polling interval (4601, api on 4600 by default)',
    usage: 'just crust observe [--host] [--open] [--strictPort]',
    flags: [
      {
        name: '--host [<address>]',
        detail:
          'listen on every interface, or the one given, so another machine can watch',
      },
      {
        name: '--open',
        detail: 'open the app in a browser once it is listening',
      },
      {
        name: '--strictPort',
        detail: 'fail rather than pick a different port',
      },
    ],
    env: [],
    examples: [
      'just crust observe',
      'just crust observe --host',
      'just crust observe --host 127.0.0.1 --strictPort',
    ],
  },
  {
    name: 'prune',
    group: 'housekeeping',
    summary: 'forget runs older than N days, on disk and in the trace together',
    usage: 'just crust prune <14d|36h> [--yes] [--db <path>] [--tree <path>]',
    flags: [
      { name: '--yes', detail: 'actually delete; dry by default' },
      {
        name: '--tree <path>',
        detail:
          'restrict pruning to runs whose workspace_root matches exactly; omitted, the whole store is pruned',
      },
    ],
    env: [],
    examples: ['just crust prune 14d', 'just crust prune 14d --yes'],
  },
  {
    name: 'update',
    group: 'housekeeping',
    summary: 'bring this tree up to date with the pi-crust it was stamped from',
    usage: 'just crust update',
    flags: [],
    env: [],
    examples: ['just crust update'],
  },
]

export const recipeDoc = (name: string): TRecipeDoc | undefined =>
  RECIPE_DOCS.find((doc) => doc.name === name)
