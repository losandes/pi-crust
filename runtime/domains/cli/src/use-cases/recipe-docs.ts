/** Each command is defined once here; runtime/cli.ts dispatches from this table. */

export type TDocLine = Readonly<{ name: string; detail: string }>

export type TRecipeGroup =
  | 'getting started'
  | 'running work'
  | 'steering a run'
  | 'reading the trace'
  | 'housekeeping'

export type TCommandRun = Readonly<{
  script: string
  config: boolean
  fixed: readonly string[]
  required: readonly string[]
  repeat: boolean
  rest: boolean
  repository: boolean
  /** the Lifecycle this command always runs; absent on every other command */
  lifecycle?: string
}>

export type TRecipeDoc = Readonly<{
  run: TCommandRun
  name: string
  group: TRecipeGroup
  /** one line, as the bare `crust` listing shows */
  summary: string
  /** begins `crust <name>` */
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
      'pi-crust.toml to read; crust passes the repository file to most commands automatically',
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
      'a pi-crust checkout that carries out the whole command instead of the one crust was started from; unset, crust runs its own runtime',
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

const LIFECYCLE_COMMANDS: readonly string[] = [
  'gh-issue',
  'ship',
  'ship-plan',
  'ship-outcome',
]

const lifecycleCommandDoc = (name: string): TRecipeDoc => ({
  name,
  run: {
    script: 'runtime/commands/run.ts',
    config: true,
    fixed: [],
    required: [],
    repeat: false,
    rest: true,
    repository: true,
    lifecycle: name,
  },
  group: 'running work',
  summary: `run the ${name} Lifecycle; the same run as crust run "<prompt>" --lifecycle ${name}`,
  usage: `crust ${name} "<prompt or path/to/prompt.md>" [options]`,
  flags: [
    {
      name: '[options]',
      detail:
        'every crust run flag except --lifecycle and --activities; crust help run lists them',
    },
  ],
  env: [],
  examples: [
    `crust ${name} "add a /health endpoint"`,
    `crust ${name} path/to/prompt.md --name "health endpoint"`,
  ],
})

export const RECIPE_DOCS: readonly TRecipeDoc[] = [
  {
    name: 'help',
    run: {
      script: 'runtime/commands/help.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: false,
    },
    group: 'getting started',
    summary: 'every recipe, every flag, and what this repo can run',
    usage: 'crust help [<recipe>]',
    flags: [
      {
        name: '--commands',
        detail:
          "only each command's name and summary, which is what a bare crust prints",
      },
      {
        name: '<recipe>',
        detail: 'narrow the output to one recipe\u2019s entry',
      },
    ],
    env: [],
    examples: ['crust help', 'crust help run'],
  },
  {
    name: 'default',
    run: {
      script: 'runtime/commands/help.ts',
      config: false,
      fixed: ['--commands'],
      required: [],
      repeat: false,
      rest: false,
      repository: false,
    },
    group: 'getting started',
    summary: 'list every crust recipe',
    usage: 'crust default  (same as the bare `crust`)',
    flags: [],
    env: [],
    examples: ['crust default'],
  },
  {
    name: 'init',
    run: {
      script: 'scripts/install.ts',
      config: false,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: false,
    },
    group: 'getting started',
    summary: 'set pi-crust up in this repository',
    usage: 'crust init [--refresh]',
    flags: [
      {
        name: '--refresh',
        detail: 'replace template-owned files; never pi-crust.toml or run data',
      },
    ],
    env: [],
    examples: ['crust init', 'crust init --refresh'],
  },
  {
    name: 'demo',
    run: {
      script: 'runtime/commands/demo.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'getting started',
    summary: 'start here: two cheap read-only runs, end to end',
    usage: 'crust demo',
    flags: [],
    env: [],
    examples: ['crust demo'],
  },
  {
    name: 'list',
    run: {
      script: 'runtime/commands/list.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: false,
    },
    group: 'getting started',
    summary:
      'what this repository offers, read from its own configuration (the catalogue alone; help adds the recipes)',
    usage: 'crust list [--config <path>]',
    flags: [],
    env: [],
    examples: ['crust list'],
  },
  {
    name: 'config',
    run: {
      script: 'runtime/commands/config.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: false,
    },
    group: 'getting started',
    summary:
      'effective TOML settings, entry models and prompt directories, with their layer and file sources',
    usage: 'crust config [--config <path>]',
    flags: [],
    env: [],
    examples: ['crust config'],
  },
  {
    name: 'please',
    run: {
      script: 'runtime/commands/please.ts',
      config: false,
      fixed: [],
      required: [],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'getting started',
    summary: 'build the command by answering questions',
    usage: 'crust please',
    flags: [],
    env: [],
    examples: ['crust please'],
  },
  {
    name: 'run',
    run: {
      script: 'runtime/commands/run.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: true,
    },
    group: 'running work',
    summary: 'run a Lifecycle, or any chain of Activities',
    usage:
      'crust run "<prompt or path/to/prompt.md>" <--lifecycle <name> | --activities a,b,c>',
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
      'crust run "add a /health endpoint" --lifecycle sdlc',
      'crust run "add a /health endpoint" --activities plan,build,review+code-review',
      'crust run "the original request" --lifecycle sdlc --run-id 9d67c31f --resume',
      'crust run "..." --lifecycle sdlc --handoff specs/{session_id}',
      'crust run "..." --lifecycle deliver -m build=openai/gpt-5@high,code-review=@xhigh',
    ],
  },
  ...LIFECYCLE_COMMANDS.map(lifecycleCommandDoc),
  {
    name: 'operator',
    run: {
      script: 'runtime/commands/operator.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: true,
    },
    group: 'running work',
    summary: 'let it choose the chain and run it',
    usage:
      'crust operator "<prompt or path/to/prompt.md>" [--trust-level 50] [--run-id a1b2c3d4] [--resume]',
    flags: [
      {
        name: '--trust-level 50',
        detail: 'how much it decides for itself before stopping for you',
      },
      { name: '--run-id <id>', detail: 'an existing run to add to' },
      { name: '--resume', detail: 'continue that run where it stopped' },
    ],
    env: [],
    examples: ['crust operator "the webhook drops retries"'],
  },
  {
    name: 'triage',
    run: {
      script: 'runtime/commands/triage.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: true,
    },
    group: 'running work',
    summary: 'recommend a lifecycle instead of running it',
    usage:
      'crust triage "<prompt or path/to/prompt.md>" [--run-id a1b2c3d4] [--resume]',
    flags: [
      { name: '--run-id <id>', detail: 'an existing run to add to' },
      { name: '--resume', detail: 'continue that run where it stopped' },
    ],
    env: [],
    examples: ['crust triage "the webhook drops retries"'],
  },
  {
    name: 'verify',
    run: {
      script: 'runtime/commands/verify.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: true,
    },
    group: 'running work',
    summary: 'run the change tasks over what you changed',
    usage: 'crust verify [--scope <ref|range|path|glob>] [--config <path>]',
    flags: [
      {
        name: '--scope <ref|range|path|glob>',
        detail:
          'what to check (--base is the older name); omitted runs against changed and untracked files',
      },
    ],
    env: [],
    examples: ['crust verify', 'crust verify --scope apps/gateway'],
  },
  {
    name: 'approve',
    run: {
      script: 'runtime/commands/approve.ts',
      config: false,
      fixed: [],
      required: ['run-id'],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'steering a run',
    summary: 'continue a run that is waiting for you',
    usage: 'crust approve <run-id>',
    flags: [],
    env: [],
    examples: ['crust approve 9d67c31f'],
  },
  {
    name: 'reject',
    run: {
      script: 'runtime/commands/reject.ts',
      config: false,
      fixed: [],
      required: ['run-id'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'steering a run',
    summary: 'send it back with a correction',
    usage: 'crust reject <run-id> [--note "..."]',
    flags: [{ name: '--note "..."', detail: 'what to change' }],
    env: [],
    examples: ['crust reject 9d67c31f --note "use the registry, not the map"'],
  },
  {
    name: 'answer',
    run: {
      script: 'runtime/commands/answer.ts',
      config: false,
      fixed: [],
      required: ['run-id'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'steering a run',
    summary: 'answer the questions it could not',
    usage: 'crust answer <run-id> [--file <path>]',
    flags: [
      {
        name: '--file <path>',
        detail: 'a file of answers instead of a flag value',
      },
    ],
    env: [],
    examples: ['crust answer 9d67c31f --file a.md'],
  },
  {
    name: 'resume',
    run: {
      script: 'runtime/commands/resume.ts',
      config: false,
      fixed: [],
      required: ['run-id'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'steering a run',
    summary:
      'pick a stopped run back up, optionally with a note every activity from here reads',
    usage: 'crust resume <run-id> [--note "what you changed"] [--detach]',
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
    examples: ['crust resume 9d67c31f --note "I fixed the failing migration"'],
  },
  {
    name: 'steer',
    run: {
      script: 'runtime/commands/steer.ts',
      config: false,
      fixed: [],
      required: ['run-id', 'activity'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'steering a run',
    summary: 'send a run back to an activity with new instructions',
    usage:
      'crust steer <run-id> <activity> <--overwrite|--branch> "instruction" [--seeding fork|fresh] [--branch-id <id>]',
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
      'crust steer 9d67c31f build --overwrite "use the registry, not the map"',
      'crust steer 9d67c31f build --branch --seeding fresh "start over"',
    ],
  },
  {
    name: 'ask',
    run: {
      script: 'runtime/commands/ask.ts',
      config: false,
      fixed: [],
      required: ['run-id', 'activity'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'steering a run',
    summary:
      'ask a finished activity a question \u2014 it still remembers the conversation',
    usage: 'crust ask <run-id> <activity> "question"',
    flags: [],
    env: [],
    examples: [
      'crust ask 9d67c31f design "why did you choose a registry table?"',
    ],
  },
  {
    name: 'amend',
    run: {
      script: 'runtime/commands/amend.ts',
      config: false,
      fixed: [],
      required: ['run-id', 'activity'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'steering a run',
    summary: 'have a finished activity revise its own document',
    usage: 'crust amend <run-id> <activity> "what to change"',
    flags: [],
    env: [],
    examples: ['crust amend 9d67c31f design "shorten section 3"'],
  },
  {
    name: 'join',
    run: {
      script: 'runtime/commands/join.ts',
      config: false,
      fixed: [],
      required: ['run-id', 'activity'],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'steering a run',
    summary: "step into a stopped run's conversation",
    usage: 'crust join <run-id> <activity>',
    flags: [],
    env: [],
    examples: ['crust join 9d67c31f build'],
  },
  {
    name: 'report',
    run: {
      script: 'runtime/commands/report.ts',
      config: true,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: true,
    },
    group: 'reading the trace',
    summary: 'where a run got to, and what to run to finish it',
    usage: 'crust report [<run-id>] [--json] [--db <path>] [--config <path>]',
    flags: [
      {
        name: '--json',
        detail: 'emit TRunState verbatim, for an agent to parse',
      },
    ],
    env: [],
    examples: ['crust report', 'crust report 9d67c31f'],
  },
  {
    name: 'report-json',
    run: {
      script: 'runtime/commands/report.ts',
      config: true,
      fixed: ['--json'],
      required: [],
      repeat: false,
      rest: true,
      repository: true,
    },
    group: 'reading the trace',
    summary: 'the same, as JSON for an agent to parse',
    usage: 'crust report-json [<run-id>] [--db <path>] [--config <path>]',
    flags: [],
    env: [],
    examples: ['crust report-json 9d67c31f'],
  },
  {
    name: 'sessions',
    run: {
      script: 'runtime/commands/trace.ts',
      config: true,
      fixed: ['sessions'],
      required: [],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'reading the trace',
    summary: 'the last 10 runs',
    usage: 'crust sessions',
    flags: [],
    env: [],
    examples: ['crust sessions'],
  },
  {
    name: 'activity-runs',
    run: {
      script: 'runtime/commands/trace.ts',
      config: true,
      fixed: ['activity-runs'],
      required: ['run-id'],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'reading the trace',
    summary: 'activity run status in sequence',
    usage: 'crust activity-runs <run-id>',
    flags: [],
    env: [],
    examples: ['crust activity-runs 9d67c31f'],
  },
  {
    name: 'tail',
    run: {
      script: 'runtime/commands/trace.ts',
      config: true,
      fixed: ['tail'],
      required: ['run-id'],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'reading the trace',
    summary: 'the live event tail',
    usage: 'crust tail <run-id>',
    flags: [],
    env: [],
    examples: ['crust tail 9d67c31f'],
  },
  {
    name: 'procs',
    run: {
      script: 'runtime/commands/trace.ts',
      config: true,
      fixed: ['procs'],
      required: ['run-id'],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'reading the trace',
    summary: 'what a run has alive right now, with pids',
    usage: 'crust procs <run-id>',
    flags: [],
    env: [],
    examples: ['crust procs 9d67c31f'],
  },
  {
    name: 'observe',
    run: {
      script: 'scripts/observe.ts',
      config: false,
      fixed: [],
      required: [],
      repeat: false,
      rest: true,
      repository: false,
    },
    group: 'reading the trace',
    summary:
      'boot the trace UI with merged TOML ports and polling interval (4601, api on 4600 by default)',
    usage: 'crust observe [--host] [--open] [--strictPort]',
    flags: [
      {
        name: '--host [<address>]',
        detail:
          'listen on every interface, or the one given, so another machine can watch',
      },
      {
        name: '--open',
        detail:
          'open the app in a browser once it is listening; from a clone only',
      },
      {
        name: '--strictPort',
        detail:
          'fail rather than pick a different port; an installed pi-crust always does',
      },
    ],
    env: [],
    examples: [
      'crust observe',
      'crust observe --host',
      'crust observe --host 127.0.0.1 --strictPort',
    ],
  },
  {
    name: 'prune',
    run: {
      script: 'runtime/commands/prune.ts',
      config: false,
      fixed: ['--older-than'],
      required: ['age'],
      repeat: true,
      rest: true,
      repository: true,
    },
    group: 'housekeeping',
    summary: 'forget runs older than N days, on disk and in the trace together',
    usage: 'crust prune <14d|36h> [--yes] [--db <path>] [--tree <path>]',
    flags: [
      { name: '--yes', detail: 'actually delete; dry by default' },
      {
        name: '--tree <path>',
        detail:
          'restrict pruning to runs whose workspace_root matches exactly; omitted, the whole store is pruned',
      },
    ],
    env: [],
    examples: ['crust prune 14d', 'crust prune 14d --yes'],
  },
  {
    name: 'update',
    run: {
      script: 'scripts/install.ts',
      config: false,
      fixed: ['--refresh'],
      required: [],
      repeat: false,
      rest: false,
      repository: true,
    },
    group: 'housekeeping',
    summary: 'bring this tree up to date with the pi-crust it was stamped from',
    usage: 'crust update',
    flags: [],
    env: [],
    examples: ['crust update'],
  },
]

export const recipeDoc = (name: string): TRecipeDoc | undefined =>
  RECIPE_DOCS.find((doc) => doc.name === name)
