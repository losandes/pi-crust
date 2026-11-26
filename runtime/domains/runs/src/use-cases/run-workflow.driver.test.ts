import { parse } from 'smol-toml'
import {
  resolveRunDirectory,
  sessionsDirIn,
} from '../../../../../lib/run-directories'
import { configText, tomlText } from '../../../../testing/config-document'
/**
 * `run-workflow.ts` (COVERAGE-WORKFLOW-DRIVERS.md).
 *
 * `spentAlready`, `pinBaseline` and `runPlannedChain` are unit-tested
 * directly. `runWorkflow` itself builds its Activities from
 * `crust.activities.toml` through `runnableActivities`, which resolves to
 * `agentActivity` with its live `TAgentPorts` default. Most scenarios here
 * drive `runWorkflow` through a real `--resume`: every Activity Run the
 * chain would execute is already recorded successful in the trace, with its
 * envelope already on disk, so the whole chain replays and no agent is ever
 * spawned.
 *
 * The human-gate scenarios need an Activity to actually RUN rather than
 * replay \u2014 a gate is deliberately suppressed on a resumed one ("a stage
 * that was already successful before this process started has already been
 * gated", revise-loop.ts's own comment on the same rule). `runWorkflow` and
 * `runPlannedChain` both grew an optional, defaulted `agentPorts` parameter
 * for exactly this: no real caller passes one, so `liveAgent` keeps
 * answering every production call, and a test here can pass an in-process
 * `TAgentPorts` whose `run` returns a canned `TPiResult` with no `pi`
 * process, no git subprocess and no network call anywhere in the path \u2014
 * the same ports record COVERAGE-AGENT-PORTS.md built and said this
 * document would go on to consume.
 *
 * `pi --list-models` is the one subprocess this file cannot avoid \u2014
 * `validateAgents` shells out to it for every required agent, by production
 * code this document does not own \u2014 so the configured model is one this
 * machine's catalogue actually has.
 */

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  activityRunParams,
  crustConfigSchema,
  EXIT,
} from '../../../../lib/contracts'
import { plain } from '../../../../lib/terminal'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import type { TPiResult, TResolveModel } from '../../../agents'
import { emptyUsage } from '../../../agents'
import { createTracer } from '../../../trace'
import {
  ledgerSeed,
  pinBaseline,
  runPlannedChain,
  runWorkflow,
  spentAlready,
} from './run-workflow'

const aPiResult = (text: string): TPiResult => ({
  text,
  returncode: 0,
  sessionId: 'session-1',
  tokens: 0,
  cost: 0,
  usage: emptyUsage,
  contextTokens: 0,
  contextWindow: 0,
})

/**
 * A `TAgentPorts` whose `run` answers with a prepared envelope and whose
 * every other port is an in-memory no-op \u2014 nothing here reaches a real
 * process, a real git command or the filesystem beyond what the caller
 * already asked for (`savePrompt`/`render` still touch disk, exactly as
 * `agent-activity.test.ts`'s own `fakePorts` does).
 */
const fakeAgentPorts = (
  envelope: Readonly<Record<string, unknown>>,
): TAgentPorts => ({
  run: async () => aPiResult(JSON.stringify(envelope)),
  changed: () => [],
  untracked: () => [],
  render: (templatePath) => `rendered:${templatePath}`,
  savePrompt: (directory, name) => join(directory, name),
  snapshot: () => ({}),
  rev: () => '',
  head: () => '',
  history: () => () => [],
  content: () => ({ status: 'ok', data: {} }),
})

const workflowEnvironment = () => {
  const environment = {
    machine: process.env.CRUST_MACHINE_CONFIG ?? '',
    data: process.env.CRUST_DATA_DIR ?? '',
  }
  silenceTerminal()
  /*
   * This machine may carry its own `~/.pi-crust/config/crust.config.toml`,
   * whose `override:` section beats a repository's own config (1.2.3 of
   * issue #24) — observed here resolving the database inside `defaults.data_dir` at
   * `{primary_worktree}/.pi-crust/data/crust.db` regardless of what a test's
   * own config says. Pointed at a path that does not exist, so these tests
   * see only the config they wrote.
   */
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API load-config reads, and this fixture is the adapter that owns the assignment
  process.env.CRUST_MACHINE_CONFIG = '/nonexistent/crust-machine-config'
  /*
   * Empty, never `undefined`.
   *
   * `process.env.X = undefined` deletes the variable in bun 1.3 and stores
   * the literal string "undefined" in bun 1.4, so a test that "cleaned up"
   * that way left CRUST_DATA_DIR="undefined" behind for every file that ran
   * after it — paths with a `/undefined/` segment, and a provenance of
   * "CRUST_DATA_DIR (environment)", in eleven tests that had nothing to do
   * with it. Empty is what `dataDirFromEnv` already reads as unset.
   */
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API load-config reads, and this fixture is the adapter that owns the assignment
  process.env.CRUST_DATA_DIR = ''
  return {
    [Symbol.dispose]: () => {
      restoreTerminal()
      // biome-ignore lint/plugin/no-object-mutation: restore the process environment owned by this fixture
      process.env.CRUST_MACHINE_CONFIG = environment.machine
      // biome-ignore lint/plugin/no-object-mutation: restore the process environment owned by this fixture
      process.env.CRUST_DATA_DIR = environment.data
    },
  }
}

/**
 * Model resolution as a value, so no test here needs a pi install.
 *
 * `validateAgents` resolves every required agent's model through
 * `pi --list-models`, and an absent pi reads as "no model by that name" —
 * which turned a missing host into a configuration fault on any machine
 * without one, this repository's CI runner included. The production default
 * is unchanged; these tests pass their own, because whether the fixture's
 * model is registered on the machine running the suite is not what any of
 * them is about.
 */
const fixtureModel: TResolveModel = (pattern) => {
  const slash = pattern.indexOf('/')
  return slash === -1
    ? { provider: 'anthropic', modelId: pattern }
    : { provider: pattern.slice(0, slash), modelId: pattern.slice(slash + 1) }
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/run-workflow::spentAlready with token configuration',
    'when a joined run has spent an agent attempt in the resolved store',
    'it should seed the ledger with that activity name',
  ].join(', '),
  () => {
    // given
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-ledger-token-')),
    )
    const dbPath = join(root, '.pi-crust', 'data', 'crust.db')
    const tracer = createTracer(dbPath, join(root, 'events.jsonl'))
    try {
      tracer.sessionStart('aaaa1111', 'tester', 'compose')
      tracer.activityRunUpsert({
        activity_run_id: 'aaaa1111_01_build',
        run_id: 'aaaa1111',
        seq: 1,
        params: activityRunParams({
          name: 'build',
          kind: 'agent',
          owner: 'build',
          description: 'Spend one attempt',
        }),
        status: 'success',
        error: undefined,
        started_at: undefined,
        ended_at: undefined,
      })
      const cfg = crustConfigSchema.parse({
        defaults: { data_dir: '{primary_worktree}/.pi-crust/data' },
        observability: {},
        agents: [],
      })

      // when
      const actual = spentAlready(cfg, 'aaaa1111', root)
      const seed = ledgerSeed(cfg, 'aaaa1111', false, root)

      // then
      expect(actual).toEqual(['build'])
      expect(seed).toEqual(['build'])
    } finally {
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
)

const MODEL = 'anthropic/claude-haiku-4-5'

/** `process.cwd()`-sensitive helpers (`isRepo`, `rev`) need a real chdir. */
const inDir = <TResult>(dir: string, body: () => TResult): TResult => {
  const was = process.cwd()
  process.chdir(dir)
  try {
    return body()
  } finally {
    process.chdir(was)
  }
}

test(
  [
    'given use-cases/run-workflow::spentAlready',
    'when this session already spent an attempt on an agent Activity',
    "it should carry that instance's name forward, for a run JOINED by this session's own trace",
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-spent-'))
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('aaaa1111', 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: 'aaaa1111_01_build',
      run_id: 'aaaa1111',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'exercise spentAlready',
      }),
      status: 'success',
      error: undefined,
      started_at: undefined,
      ended_at: undefined,
    })
    tracer.close()
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: join(dbPath, '..') },
      agents: [],
    })

    // when
    const withRun = spentAlready(cfg, 'aaaa1111')
    const withNoRun = spentAlready(cfg, undefined)

    // then
    expect(withRun).toEqual(['build'])
    expect(withNoRun).toEqual([])
  },
)

test(
  [
    'given use-cases/run-workflow::ledgerSeed',
    'when the same session is joined with --run-id, with and without --resume',
    'it should carry what the trace spent only when the process is not an explicit resume',
  ].join(', '),
  () => {
    // given — the same fixture trace spentAlready's own test reads
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-ledger-seed-'))
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('aaaa1111', 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: 'aaaa1111_01_build',
      run_id: 'aaaa1111',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'exercise ledgerSeed',
      }),
      status: 'success',
      error: undefined,
      started_at: undefined,
      ended_at: undefined,
    })
    tracer.close()
    const cfg = crustConfigSchema.parse({
      defaults: { data_dir: join(dbPath, '..') },
      agents: [],
    })

    // when, then — an explicit resume starts the budget empty; a plain
    // --run-id join carries what the trace already spent
    expect(ledgerSeed(cfg, 'aaaa1111', true)).toEqual([])
    expect(ledgerSeed(cfg, 'aaaa1111', false)).toEqual(['build'])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/run-workflow::pinBaseline',
    'when the chain names document and the workspace is a git repository',
    'it should pin HEAD; off a repository, it should pin nothing',
  ].join(', '),
  () => {
    // given — a repository with one commit, and a bare directory with none
    const repo = realpathSync(
      mkdtempSync(join(tmpdir(), 'crust-run-workflow-pin-repo-')),
    )
    const git = (...args: readonly string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'tester@example.com')
    git('config', 'user.name', 'tester')
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'README.md'), 'hello\n')
    git('add', '-A')
    git('commit', '-qm', 'first')
    const notARepo = mkdtempSync(
      join(tmpdir(), 'crust-run-workflow-pin-plain-'),
    )

    // when
    const pinned = inDir(repo, () => pinBaseline(['build', 'document']))
    const unpinned = inDir(notARepo, () => pinBaseline(['build', 'document']))
    const noDocument = inDir(repo, () => pinBaseline(['build']))

    // then
    expect(pinned.length).toBeGreaterThan(0)
    expect(unpinned).toEqual('')
    expect(noDocument).toEqual('')
  },
)

/** A config file + activity file pair, on disk, for `loadConfigWithNotes`. */
const configFor = (
  dir: string,
  activities: readonly Readonly<Record<string, unknown>>[],
  /** Entries for `terminal:`, for a plan that names a terminal Activity. */
  terminal: readonly Readonly<Record<string, unknown>>[] = [],
): string => {
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  writeFileSync(system, '# system\n')
  writeFileSync(user, '# user\n')
  const dataDir = join(dir, 'data')
  const configPath = join(dir, 'pi-crust.toml')
  const entries = activities.map((activity) => ({
    model: MODEL,
    purpose: `Perform ${activity.name}`,
    prompts: dirname(system),
    writes: [],
    ...activity,
  }))
  const terminalEntries = terminal.map((one) => ({
    model: MODEL,
    prompts: dirname(system),
    writes: [],
    ...one,
  }))
  writeFileSync(
    configPath,
    configText({
      defaults: { data_dir: dataDir },
      observability: {},
      agents: [...entries, ...terminalEntries],
      activities: entries,
      terminal: terminalEntries,
    }),
  )
  return configPath
}

/** A fresh run: no run id, nothing to resume. */
const freshArgs = (configPath: string): Parameters<typeof runWorkflow>[0] => ({
  ...argsFor(configPath, ''),
  runId: undefined,
  resume: false,
})

const argsFor = (
  configPath: string,
  runId: string,
): Parameters<typeof runWorkflow>[0] => ({
  prompt: 'implement the thing',
  config: configPath,
  runId,
  base: undefined,
  resume: true,
  activities: undefined,
  lifecycle: undefined,
  models: undefined,
  approveAfter: undefined,
  commit: undefined,
  stream: false,
  trustLevel: undefined,
  handoff: undefined,
  name: undefined,
})

const overrideFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-models-'))
  const environment = workflowEnvironment()

  return {
    dir,
    [Symbol.dispose]: () => {
      environment[Symbol.dispose]()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const workflowEvents = (dir: string, runId: string) =>
  readFileSync(
    join(
      resolveRunDirectory({
        dbPath: join(dir, 'data', 'crust.db'),
        sessionsDir: sessionsDirIn(join(dir, 'data')),
      })(runId),
      'events.jsonl',
    ),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

const overrideWarningsIn = (
  events: ReturnType<typeof workflowEvents>,
): readonly string[] =>
  events
    .filter((event) => event.type === 'log')
    .map((event) => String(event.payload.message))
    .filter((message) => message.includes('--model:'))
    .map((message) => message.slice(message.indexOf('--model:')))

const partialModelOverrides = [
  {
    setting: 'a model-only alias',
    models: 'b=openai/gpt-5',
    model: 'openai/gpt-5',
    thinking: 'provider-adaptive',
    warnings: [],
  },
  {
    setting: 'a thinking-only alias',
    models: 'b=@off',
    model: MODEL,
    thinking: 'off',
    warnings: [],
  },
  {
    setting: 'an invalid thinking-only entry',
    models: 'build=@extreme',
    model: MODEL,
    thinking: 'provider-adaptive',
    warnings: [
      "--model: ignored thinking level 'extreme' for 'build' — use one of off, minimal, low, medium, high, xhigh, max",
    ],
  },
  {
    setting: 'a later model-only setting',
    models: 'build=discarded/model@xhigh,build=openai/gpt-5',
    model: 'openai/gpt-5',
    thinking: 'provider-adaptive',
    warnings: [
      "--model: 'build' is named more than once — using 'build=openai/gpt-5'",
    ],
  },
  {
    setting: 'an empty comma list',
    models: ' , , ',
    model: MODEL,
    thinking: 'provider-adaptive',
    warnings: [],
  },
] as const

for (const {
  setting,
  models,
  model,
  thinking,
  warnings,
} of partialModelOverrides) {
  test(
    [
      'given #112 requirements 1.2 and 1.3, a configured activity with an alias',
      `when --model supplies ${setting}`,
      'it should send and record only the applicable changes, preserving the other configured field',
    ].join(', '),
    async () => {
      // given
      using fixture = overrideFixture()
      const { dir } = fixture
      const configPath = configFor(dir, [
        {
          name: 'build',
          aliases: ['b'],
          thinking: 'provider-adaptive',
          output: 'genericOutput',
          attempts: 1,
          commit: false,
        },
      ])
      const runId = '1120bb01'
      const canned = fakeAgentPorts({
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      })
      let spawned: Parameters<TAgentPorts['run']>[0] | undefined
      const ports: TAgentPorts = {
        ...canned,
        run: (request) => {
          spawned = request
          return canned.run(request)
        },
      }

      // when
      const exitCode = await runWorkflow(
        { ...freshArgs(configPath), runId, models },
        [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
        ports,
        fixtureModel,
        async () => false,
      )
      const events = workflowEvents(dir, runId)

      // then
      expect(exitCode).toBe(EXIT.SUCCESS)
      expect(spawned).toMatchObject({ model, thinking })
      expect(
        events
          .filter((event) => event.type === 'agent_start')
          .map((event) => ({
            name: event.name,
            model: event.payload.model,
            thinking: event.payload.thinking,
          })),
      ).toEqual([{ name: 'build', model, thinking }])
      expect(overrideWarningsIn(events)).toEqual(warnings)
    },
  )
}

test(
  [
    'given #112 requirements 1.3.6 and 1.4.4, repository and machine settings and an unread legacy file',
    'when a model override is followed by a separate run without the flag',
    'it should win only in the first run, leave every file unchanged, and print config warnings before override warnings',
  ].join(', '),
  async () => {
    // given
    using fixture = overrideFixture()
    const { dir } = fixture
    const configPath = configFor(dir, [
      { name: 'build', output: 'genericOutput', attempts: 1, commit: false },
    ])
    const machinePath = join(dir, 'machine')
    const legacyDirectory = join(dir, '.pi-crust/config')
    mkdirSync(machinePath, { recursive: true })
    mkdirSync(legacyDirectory, { recursive: true })
    const layers = [
      {
        path: join(machinePath, 'crust.activities.toml'),
        text: '[activities.build]\nmodel = "machine/model"\nthinking = "high"\n',
      },
      {
        path: join(legacyDirectory, 'crust.activities.local.yaml'),
        text: 'unread legacy configuration',
      },
    ]
    for (const { path, text } of layers) writeFileSync(path, text)
    const repository = parse(readFileSync(configPath, 'utf8'))
    writeFileSync(
      configPath,
      tomlText({
        ...repository,
        activities: {
          build: {
            purpose: 'Build the requested change',
            prompts: dir,
            writes: [],
            output: 'genericOutput',
            attempts: 1,
            commit: false,
            model: 'repository/model',
            thinking: 'max',
          },
        },
      }),
    )
    // biome-ignore lint/plugin/no-object-mutation: this disposable fixture owns the machine-config environment boundary
    process.env.CRUST_MACHINE_CONFIG = machinePath
    const filesBefore = [configPath, ...layers.map(({ path }) => path)].map(
      (path) => ({ path, text: readFileSync(path, 'utf8') }),
    )
    const ports = fakeAgentPorts({
      status: 'success',
      summary: 'built it',
      artifacts: [],
      notes_for_next_agent: '',
    })
    const plan = [
      { name: 'implement', strategy: 'serial' as const, activities: ['build'] },
    ]

    // when
    const overridden = await runWorkflow(
      {
        ...freshArgs(configPath),
        runId: '1120bb02',
        models: 'nameless,build=openai/gpt-5@xhigh,biuld=missing/model',
      },
      plan,
      ports,
      fixtureModel,
      async () => false,
    )
    const configured = await runWorkflow(
      { ...freshArgs(configPath), runId: '1120bb03' },
      plan,
      ports,
      fixtureModel,
      async () => false,
    )
    const firstEvents = workflowEvents(dir, '1120bb02')
    const firstAgent = firstEvents.findIndex(
      (event) => event.type === 'agent_start',
    )
    const notices = firstEvents.filter(
      (event) =>
        event.type === 'log' &&
        (String(event.payload.message).includes('not read') ||
          String(event.payload.message).includes('--model:')),
    )

    // then
    expect([overridden, configured]).toEqual([EXIT.SUCCESS, EXIT.SUCCESS])
    expect(
      ['1120bb02', '1120bb03'].flatMap((runId) =>
        workflowEvents(dir, runId)
          .filter((event) => event.type === 'agent_start')
          .map((event) => ({
            model: event.payload.model,
            thinking: event.payload.thinking,
          })),
      ),
    ).toEqual([
      { model: 'openai/gpt-5', thinking: 'xhigh' },
      { model: 'repository/model', thinking: 'max' },
    ])
    expect(
      notices.map((event) => {
        const message = String(event.payload.message)
        const marker = message.includes('--model:') ? '--model:' : 'not read'
        return message.slice(message.indexOf(marker))
      }),
    ).toEqual([
      expect.stringContaining('not read'),
      "--model: ignored 'nameless' — name the activity it applies to, as <activity>=<provider/model>@<thinking>",
      "--model: no activity named 'biuld' in this repository — ignored",
    ])
    expect(firstAgent).toBeGreaterThan(-1)
    const printed = plain(terminalOutput())
    for (const notice of notices) {
      expect(firstEvents.indexOf(notice)).toBeLessThan(firstAgent)
      expect(printed).toContain(notice.payload.message)
    }
    expect(printed.indexOf(notices[0]?.payload.message)).toBeLessThan(
      printed.indexOf(notices[1]?.payload.message),
    )
    expect(
      filesBefore.map(({ path }) => ({
        path,
        text: readFileSync(path, 'utf8'),
      })),
    ).toEqual(filesBefore)
  },
)

test(
  [
    'given #112 requirements 1.3.4, 1.3.5 and 1.4.3, invalid models on unknown and unused names',
    'when only build is selected',
    'it should warn and run build without attempting to resolve either unused model',
  ].join(', '),
  async () => {
    // given
    using fixture = overrideFixture()
    const { dir } = fixture
    const configPath = configFor(dir, [
      { name: 'build', output: 'genericOutput', attempts: 1, commit: false },
      { name: 'ux-design', output: 'genericOutput' },
    ])
    const resolve: TResolveModel = (pattern) => {
      if (pattern.startsWith('missing/')) {
        throw new Error(`no model matches '${pattern}'`)
      }
      return fixtureModel(pattern)
    }
    const runId = '1120bb04'

    // when
    const exitCode = await runWorkflow(
      {
        ...freshArgs(configPath),
        runId,
        models: 'biuld=missing/unknown,ux-design=missing/unused,build=@high',
      },
      [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
      fakeAgentPorts({
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      }),
      resolve,
      async () => false,
    )
    const events = workflowEvents(dir, runId)

    // then
    expect(exitCode).toBe(EXIT.SUCCESS)
    expect(
      events
        .filter((event) => event.type === 'agent_start')
        .map((event) => ({
          name: event.name,
          model: event.payload.model,
          thinking: event.payload.thinking,
        })),
    ).toEqual([{ name: 'build', model: MODEL, thinking: 'high' }])
    expect(overrideWarningsIn(events)).toEqual([
      "--model: no activity named 'biuld' in this repository — ignored",
      "--model: 'ux-design' does not run in this run — the override has no effect",
    ])
  },
)

for (const name of ['build', 'gh-pull-request']) {
  test(
    [
      'given #112 requirements 1.4.1 and 1.4.3, a reviser that has not started yet and a terminal outside the activity chain',
      `when --model selects an unresolvable model for ${name}`,
      'it should refuse before even the first activity starts',
    ].join(', '),
    async () => {
      // given
      using fixture = overrideFixture()
      const { dir } = fixture
      const configPath = configFor(
        dir,
        [
          { name: 'prep', output: 'genericOutput', attempts: 1 },
          { name: 'review', output: 'reviewOutput' },
          { name: 'build', output: 'buildOutput' },
        ],
        [{ name: 'gh-pull-request', purpose: 'Deliver the reviewed change' }],
      )
      const resolve: TResolveModel = (pattern) => {
        if (pattern === 'missing/model') {
          throw new Error(`no model matches '${pattern}'`)
        }
        return fixtureModel(pattern)
      }

      // when, then
      await expect(
        runWorkflow(
          {
            ...freshArgs(configPath),
            models: `${name}=missing/model`,
            approveAfter: 'prep',
          },
          [
            {
              name: 'inspect',
              strategy: 'serial',
              activities: ['prep', 'build', 'review'],
            },
            {
              name: 'deliver',
              strategy: 'serial',
              activities: ['gh-pull-request'],
            },
          ],
          fakeAgentPorts({
            status: 'success',
            summary: 'prepared it',
            artifacts: [],
            notes_for_next_agent: '',
          }),
          resolve,
          async () => false,
        ),
      ).rejects.toThrow(`agent '${name}': no model matches 'missing/model'`)
      expect(existsSync(join(dir, 'data'))).toBe(false)
    },
  )
}

test(
  [
    'given #112 requirement 1.4.1, a reviser and terminal with otherwise unresolvable configured models',
    'when their models are overridden and the run waits after prep',
    'it should validate the replacements and not call either override unused',
  ].join(', '),
  async () => {
    // given
    using fixture = overrideFixture()
    const { dir } = fixture
    const configPath = configFor(
      dir,
      [
        { name: 'prep', output: 'genericOutput', attempts: 1 },
        { name: 'review', output: 'reviewOutput' },
        { name: 'build', output: 'buildOutput', model: 'missing/reviser' },
      ],
      [
        {
          name: 'gh-pull-request',
          purpose: 'Deliver the reviewed change',
          model: 'missing/terminal',
        },
      ],
    )
    const resolve: TResolveModel = (pattern) => {
      if (pattern.startsWith('missing/')) {
        throw new Error(`no model matches '${pattern}'`)
      }
      return fixtureModel(pattern)
    }
    const runId = '1120bb05'

    // when
    const exitCode = await runWorkflow(
      {
        ...freshArgs(configPath),
        runId,
        models: 'build=openai/gpt-5@max,gh-pull-request=openai/gpt-5@low',
        approveAfter: 'prep',
      },
      [
        {
          name: 'inspect',
          strategy: 'serial',
          activities: ['prep', 'build', 'review'],
        },
        {
          name: 'deliver',
          strategy: 'serial',
          activities: ['gh-pull-request'],
        },
      ],
      fakeAgentPorts({
        status: 'success',
        summary: 'prepared it',
        artifacts: [],
        notes_for_next_agent: '',
      }),
      resolve,
      async () => false,
    )
    const events = workflowEvents(dir, runId)

    // then
    expect(exitCode).toBe(EXIT.WAITING)
    expect(
      events
        .filter((event) => event.type === 'agent_start')
        .map((event) => event.name),
    ).toEqual(['prep'])
    expect(overrideWarningsIn(events)).toEqual([])
    expect(plain(terminalOutput())).not.toContain('does not run in this run')
  },
)

for (const selection of [
  { activities: 'build', lifecycle: undefined },
  { activities: undefined, lifecycle: 'deliver' },
]) {
  test(
    [
      'given use-cases/run-workflow::runWorkflow',
      `when --model overrides a run selected by ${selection.lifecycle === undefined ? '--activities' : '--lifecycle'}`,
      'it should validate and trace the overridden model and thinking level instead of machine configuration',
    ].join(', '),
    async () => {
      // given
      using fixture = overrideFixture()
      const { dir } = fixture
      const configPath = configFor(dir, [
        { name: 'build', output: 'genericOutput', attempts: 1, commit: false },
      ])
      const machine = join(dir, 'machine')
      mkdirSync(machine)
      writeFileSync(
        join(machine, 'crust.activities.toml'),
        '[activities.build]\nmodel = "machine/model"\nthinking = "low"\n',
      )
      // biome-ignore lint/plugin/no-object-mutation: the disposable fixture owns this external configuration boundary and restores it on disposal
      process.env.CRUST_MACHINE_CONFIG = machine
      const runId = '1120aa01'
      const ports = fakeAgentPorts({
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      })

      // when
      const exitCode = await runWorkflow(
        {
          ...freshArgs(configPath),
          ...selection,
          runId,
          models: 'build=openai/gpt-5@high',
        },
        [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
        ports,
        fixtureModel,
        async () => false,
      )
      const events = workflowEvents(dir, runId)

      // then
      expect(exitCode).toBe(EXIT.SUCCESS)
      expect(
        events
          .filter((event) => event.type === 'agent_start')
          .map((event) => ({
            name: event.name,
            model: event.payload.model,
            thinking: event.payload.thinking,
          })),
      ).toEqual([{ name: 'build', model: 'openai/gpt-5', thinking: 'high' }])
    },
  )
}

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when model overrides contain an unknown name, an unused activity, and malformed settings',
    'it should trace their warnings before the first agent and still complete the run',
  ].join(', '),
  async () => {
    // given
    using fixture = overrideFixture()
    const { dir } = fixture
    const configPath = configFor(dir, [
      { name: 'build', output: 'genericOutput', attempts: 1, commit: false },
      { name: 'ux-design', output: 'genericOutput' },
    ])
    const runId = '1120aa02'
    const ports = fakeAgentPorts({
      status: 'success',
      summary: 'built it',
      artifacts: [],
      notes_for_next_agent: '',
    })

    // when
    const exitCode = await runWorkflow(
      {
        ...freshArgs(configPath),
        runId,
        models:
          'nameless,build=openai/gpt-5@extreme,biuld=openai/gpt-5,ux-design=@high',
      },
      [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
      ports,
      fixtureModel,
      async () => false,
    )
    const events = workflowEvents(dir, runId)
    const firstAgent = events.findIndex((event) => event.type === 'agent_start')
    const warnings = events.filter(
      (event) =>
        event.type === 'log' &&
        String(event.payload.message).includes('--model:'),
    )

    // then
    expect(exitCode).toBe(EXIT.SUCCESS)
    expect(firstAgent).toBeGreaterThan(-1)
    expect(warnings).toHaveLength(4)
    for (const warning of warnings) {
      expect(warning.activity_run_id).toBe('')
      expect(events.indexOf(warning)).toBeLessThan(firstAgent)
      expect(plain(terminalOutput())).toContain(warning.payload.message)
    }
    expect(warnings.map((event) => event.payload.message).join('\n')).toContain(
      "--model: no activity named 'biuld' in this repository — ignored",
    )
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when the model resolver rejects an overridden model',
    'it should refuse before creating a session or spawning an agent',
  ].join(', '),
  async () => {
    // given
    using fixture = overrideFixture()
    const { dir } = fixture
    const configPath = configFor(dir, [
      { name: 'build', output: 'genericOutput', attempts: 1, commit: false },
    ])
    const refuseModel: TResolveModel = (pattern) => {
      throw new Error(`no model matches '${pattern}'`)
    }

    // when, then
    await expect(
      runWorkflow(
        { ...freshArgs(configPath), models: 'build=missing/model' },
        [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
        fakeAgentPorts({}),
        refuseModel,
        async () => false,
      ),
    ).rejects.toThrow("no model matches 'missing/model'")
    expect(existsSync(join(dir, 'data'))).toBe(false)
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when the plan names an Activity missing required prompt files',
    'it should refuse before a session is even minted, naming the Activity and missing prompts',
  ].join(', '),
  async () => {
    // given — the roster is assembled by the loader, but prompts are checked at run start
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-validate-'))
    const configPath = join(dir, 'pi-crust.toml')
    const system = join(dir, 'system.md')
    const user = join(dir, 'user.md')
    writeFileSync(system, '# system\n')
    writeFileSync(user, '# user\n')
    writeFileSync(
      configPath,
      configText({
        defaults: { data_dir: join(dir, 'data') },
        observability: {},
        agents: [],
        activities: [
          {
            name: 'build',
            purpose: 'Build the thing',
            prompts: join(dir, 'missing-prompts'),
            output: 'genericOutput',
          },
        ],
      }),
    )
    const args = argsFor(configPath, 'bbbb2222')
    // biome-ignore lint/plugin/no-object-mutation: this fixture owns the flag it is testing
    ;(args as { resume: boolean }).resume = false

    // when, then
    await expect(
      runWorkflow(
        args,
        [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
        undefined,
        fixtureModel,
      ),
    ).rejects.toThrow(/build.*user\.md not found/s)
    expect(existsSync(join(dir, 'data'))).toBe(false)
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when every Activity Run the plan would execute is already recorded successful and resumed',
    'it should replay the whole chain and settle the run accepted, with no agent spawned',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-e2e-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const dataDir = join(dir, 'data')
    const dbPath = join(dataDir, 'crust.db')
    const runId = 'cccc3333'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    writeFileSync(
      join(sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'GenericOutput',
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      })}\n`,
    )
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'the piece this resume should replay',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    // 'fail', not 'running': a resumable session, with nothing live to refuse the resume
    tracer.sessionFinish(runId, false)
    tracer.close()
    const args = argsFor(configPath, runId)

    // when
    const exitCode = await runWorkflow(
      args,
      [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
      undefined,
      fixtureModel,
    )

    // then
    expect(exitCode).toEqual(EXIT.SUCCESS)
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when an Activity that actually runs (not replayed) leaves a question it may not settle, with a later stage still to come',
    'it should raise a human gate, wait rather than invent an answer, and settle the run as waiting',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    /*
     * 'build' is resumed and replays; 'review' is NOT resumed, so
     * it actually runs, through `fakeAgentPorts` rather than `pi`; 'document'
     * follows it, so the Authority Rule applies \u2014 a later stage would
     * otherwise have to invent the answer \u2014 and the gate fires.
     */
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-gate-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'buildOutput',
        attempts: 1,
        commit: false,
      },
      {
        name: 'review',
        purpose: 'Confirm the work',
        output: 'buildOutput',
        attempts: 1,
        commit: false,
      },
      {
        name: 'document',
        purpose: 'Write it up',
        output: 'buildOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const dataDir = join(dir, 'data')
    const dbPath = join(dataDir, 'crust.db')
    const runId = 'ddee9999'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    writeFileSync(
      join(sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'BuildOutput',
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
        facts: [],
        decisions: [],
        assumptions: [],
        risks: [],
        unresolved: [],
        objective_met: { met: true, evidence: 'fixture' },
        regress_to: { activity: '', because: '' },
        changed_files: [],
        commit_message: '',
        disputes: [],
      })}\n`,
    )
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'the piece this resume should replay',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    tracer.sessionFinish(runId, false)
    tracer.close()
    const args = argsFor(configPath, runId)
    const ports = fakeAgentPorts({
      status: 'success',
      summary: 'reviewed it',
      artifacts: [],
      notes_for_next_agent: '',
      facts: [],
      decisions: [],
      assumptions: [],
      risks: [],
      unresolved: [
        {
          question: 'which environment should this ship to first',
          consequential: true,
          beyond_this_run: false,
          provisional_answer: '',
        },
      ],
      objective_met: { met: true, evidence: 'fixture' },
      regress_to: { activity: '', because: '' },
      changed_files: ['app.ts'],
      commit_message: '',
      disputes: [],
    })

    // when
    const exitCode = await runWorkflow(
      args,
      [
        {
          name: 'implement',
          strategy: 'serial',
          activities: ['build', 'review', 'document'],
        },
      ],
      ports,
      fixtureModel,
    )

    // then \u2014 waiting, not accepted or failed; 'document' never reached
    expect(exitCode).toEqual(EXIT.WAITING)
    const after = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    expect(
      after.activityRunsFor(runId).map((one) => one.params.name),
    ).not.toContain('document')
    after.close()
  },
)

test(
  [
    'given use-cases/run-workflow::runPlannedChain',
    'when a planned Activity that actually runs leaves a question it may not settle, with another planned Activity still to come',
    'it should raise a human gate and return undefined, the same way a replay-suppressed one never does',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-planned-gate-'))
    const configPath = configFor(dir, [
      {
        name: 'review',
        purpose: 'Confirm the work',
        output: 'buildOutput',
        attempts: 1,
        commit: false,
      },
      {
        name: 'document',
        purpose: 'Write it up',
        output: 'buildOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const { startSession } = await import('./start-session')
    const { loadConfigWithNotes } = await import(
      '../../../config/src/use-cases/load-config'
    )
    const { attemptLedger } = await import('./attempts')
    const cfg = loadConfigWithNotes(configPath).config
    const run = startSession(cfg, 'eeff1010')
    const ports = fakeAgentPorts({
      status: 'success',
      summary: 'reviewed it',
      artifacts: [],
      notes_for_next_agent: '',
      facts: [],
      decisions: [],
      assumptions: [],
      risks: [],
      unresolved: [
        {
          question: 'which environment should this ship to first',
          consequential: true,
          beyond_this_run: false,
          provisional_answer: '',
        },
      ],
      objective_met: { met: true, evidence: 'fixture' },
      regress_to: { activity: '', because: '' },
      changed_files: ['app.ts'],
      commit_message: '',
      disputes: [],
    })

    // when
    const actual = await runPlannedChain(
      run,
      ['review', 'document'],
      {},
      {
        run,
        prompt: 'x',
        previous: undefined,
        previousStep: undefined,
        upstream: [],
        cohort: [],
        baseline: '',
        outcomes: [],
        feedback: [],
      },
      argsFor(configPath, 'eeff1010'),
      50,
      attemptLedger(),
      ports,
      fixtureModel,
    )

    // then \u2014 stopped for a person; 'document' never reached
    expect(actual).toBeUndefined()
    expect(
      run.tracer.eventsNamed(run.runId, 'human_gate_open').length,
    ).toBeGreaterThan(0)
    expect(run.activityRuns().map((one) => one.params.name)).not.toContain(
      'document',
    )
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when a raised trust level lets a replayed Activity answer its own consequential question',
    'it should report what it decided for itself, once, at the end of the run',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-self-answered-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'buildOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const dataDir = join(dir, 'data')
    const dbPath = join(dataDir, 'crust.db')
    const runId = 'bbcc8888'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    /*
     * `selfAnswered` is read from a replayed envelope exactly as it would be
     * from a freshly executed one -- unlike a gate, that check is not
     * suppressed by `run.resume`.
     */
    writeFileSync(
      join(sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'GenericOutput',
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
        facts: [],
        decisions: [],
        assumptions: [],
        risks: [],
        objective_met: { met: true, evidence: 'fixture' },
        regress_to: { activity: '', because: '' },
        changed_files: [],
        commit_message: '',
        disputes: [],
        unresolved: [
          {
            question: 'which retry policy should the client use',
            consequential: true,
            beyond_this_run: false,
            provisional_answer: 'exponential backoff, three attempts',
          },
        ],
      })}\n`,
    )
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'the piece this resume should replay',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    tracer.sessionFinish(runId, false)
    tracer.close()
    const args = { ...argsFor(configPath, runId), trustLevel: '100' }

    // when
    const exitCode = await runWorkflow(
      args,
      [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
      undefined,
      fixtureModel,
    )

    // then
    expect(exitCode).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain(
      'question(s) this run answered for itself',
    )
    expect(terminalOutput()).toContain('exponential backoff, three attempts')
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when an old local file remains under the legacy configuration directory',
    'it should announce that the file is not read before anything runs',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-local-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    mkdirSync(join(dir, '.pi-crust/config'), { recursive: true })
    writeFileSync(
      join(dir, '.pi-crust/config/crust.config.local.yaml'),
      'defaults: { commit: true }',
    )
    const dataDir = join(dir, 'data')
    const dbPath = join(dataDir, 'crust.db')
    const runId = 'ffff6666'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    writeFileSync(
      join(sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'GenericOutput',
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      })}\n`,
    )
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'the piece this resume should replay',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    tracer.sessionFinish(runId, false)
    tracer.close()

    // when
    const exitCode = await runWorkflow(
      argsFor(configPath, runId),
      [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
      undefined,
      fixtureModel,
    )

    // then
    expect(exitCode).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('not read')
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when a machine layer and CRUST_DATA_DIR are both in force',
    'it should say so before anything runs, naming the file and what set the data directory',
  ].join(', '),
  async () => {
    // given — a machine config outside the repository, and a data directory
    // the environment chose rather than the repository's own config: both
    // are invisible in a trace unless the run says so at the start
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-machine-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const dataDir = join(dir, 'data')
    const machineConfig = join(dir, 'machine')
    mkdirSync(machineConfig)
    writeFileSync(
      join(machineConfig, 'crust.config.toml'),
      tomlText({ defaults: { data_dir: dataDir } }),
    )
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API load-config reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_MACHINE_CONFIG = machineConfig
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API load-config reads, and this fixture is the adapter that owns the assignment
    process.env.CRUST_DATA_DIR = dataDir

    const dbPath = join(dataDir, 'crust.db')
    const runId = 'aaaa7777'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    writeFileSync(
      join(sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'GenericOutput',
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      })}\n`,
    )
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'the piece this resume should replay',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    tracer.sessionFinish(runId, false)
    tracer.close()

    // when
    const exitCode = await runWorkflow(
      argsFor(configPath, runId),
      [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
      undefined,
      fixtureModel,
    )

    // then
    expect(exitCode).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('machine config in force')
    expect(terminalOutput()).toContain(machineConfig)
    expect(terminalOutput()).toContain('CRUST_DATA_DIR')
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when the plan ends in a terminal Activity and an earlier activity run failed',
    'it should cancel the terminal rather than deliver, and say why',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    /*
     * A resumed run whose planned chain replays clean, but whose
     * trace already carries a counted activity run that failed. A terminal
     * Activity never enters the fold; it is settled after the loop, and a
     * run with a failure in it must not open a pull request for itself.
     */
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-terminal-'))
    const configPath = configFor(
      dir,
      [
        {
          name: 'build',
          purpose: 'Build the thing',
          output: 'genericOutput',
          attempts: 1,
          commit: false,
        },
      ],
      [
        {
          name: 'gh-pull-request',
          purpose: 'Open the pull request',
          output: 'genericOutput',
        },
      ],
    )
    const dataDir = join(dir, 'data')
    const dbPath = join(dataDir, 'crust.db')
    const runId = 'bbbb8888'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    writeFileSync(
      join(sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'GenericOutput',
        status: 'success',
        summary: 'built it',
        artifacts: [],
        notes_for_next_agent: '',
      })}\n`,
    )
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'the piece this resume replays',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_02_review`,
      run_id: runId,
      seq: 2,
      params: activityRunParams({
        name: 'review',
        kind: 'agent',
        owner: 'review',
        description: 'an earlier leg that failed and is not in this plan',
      }),
      status: 'fail',
      error: 'reviewer refused',
      started_at: '2024-01-01T00:00:02.000Z',
      ended_at: '2024-01-01T00:00:03.000Z',
    })
    tracer.sessionFinish(runId, false)
    tracer.close()

    // when
    const exitCode = await runWorkflow(
      argsFor(configPath, runId),
      [
        { name: 'implement', strategy: 'serial', activities: ['build'] },
        { name: 'push', strategy: 'serial', activities: ['gh-pull-request'] },
      ],
      undefined,
      fixtureModel,
    )

    // then — cancelled with its reason, and recorded as cancelled rather
    // than quietly skipped
    expect(terminalOutput()).toContain('gh-pull-request: cancelled')
    expect(exitCode).not.toEqual(EXIT.RUNNING)
    const after = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    expect(
      after
        .activityRunsFor(runId)
        .filter((one) => one.params.name === 'gh-pull-request')
        .map((one) => one.status),
    ).toEqual(['cancelled'])
    after.close()
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when a visualizer is listening on the configured backend port',
    'it should print a link to this run, and none when nothing answers',
  ].join(', '),
  async () => {
    // given — the probe as a port, because whether a developer happens to
    // have the visualizer open must not decide what a run prints
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-watch-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const ports = fakeAgentPorts({
      agent_name: 'build',
      purpose: 'Build the thing',
      output_type: 'GenericOutput',
      status: 'success',
      summary: 'built it',
      artifacts: [],
      notes_for_next_agent: '',
    })
    const plan = [
      { name: 'implement', strategy: 'serial' as const, activities: ['build'] },
    ]

    // when
    const watched = await runWorkflow(
      freshArgs(configPath),
      plan,
      ports,
      fixtureModel,
      () => Promise.resolve(true),
    )
    const withLink = terminalOutput()
    restoreTerminal()
    silenceTerminal()
    const unwatched = await runWorkflow(
      freshArgs(configPath),
      plan,
      ports,
      fixtureModel,
      () => Promise.resolve(false),
    )

    // then
    expect(watched).toEqual(EXIT.SUCCESS)
    expect(unwatched).toEqual(EXIT.SUCCESS)
    expect(withLink).toContain('watch:')
    expect(terminalOutput()).not.toContain('watch:')
  },
)

const openedIssueEnvelope = {
  status: 'success',
  summary: 'opened the issue',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
  issue_url: 'https://github.com/acme/widgets/issues/42',
  issue_number: 42,
  repo: 'acme/widgets',
}

test(
  [
    'given an opened issue whose reported number fails its gate',
    'when the workflow exhausts its attempts outside the Activity Run',
    'it should reject and print one failed panel followed by the issue link',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-workflow-issue-gate-'))
    const configPath = configFor(dir, [
      {
        name: 'open-issue',
        output: 'ghIssueOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const ports = fakeAgentPorts({ ...openedIssueEnvelope, issue_number: 43 })
    try {
      // when, then
      await expect(
        runWorkflow(
          { ...argsFor(configPath, 'abcd1871'), resume: false },
          [
            {
              name: 'discover',
              strategy: 'serial',
              activities: ['open-issue'],
            },
          ],
          ports,
          fixtureModel,
        ),
      ).rejects.toThrow('has no attempts left')
      const output = plain(terminalOutput())
      const lines = output.trimEnd().split('\n')
      expect(output.split('pi-crust run complete')).toHaveLength(2)
      expect(output).toContain('✗ fail')
      expect(lines[lines.findIndex((line) => line.startsWith('╰')) + 1]).toBe(
        `  issue          ${openedIssueEnvelope.issue_url}`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given concurrent siblings where one fails before the other opens an issue',
    'when the workflow finishes waiting for both siblings',
    'it should reject and print the late issue link after exactly one completion panel',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-workflow-concurrent-issue-'))
    const runId = 'abcd1872'
    const configPath = configFor(dir, [
      {
        name: 'fails-first',
        output: 'genericOutput',
        attempts: 1,
        writes: [],
        model: 'fixture/fails',
        commit: false,
      },
      {
        name: 'opens-later',
        output: 'ghIssueOutput',
        attempts: 1,
        writes: [],
        model: 'fixture/opens',
        commit: false,
      },
    ])
    const ports: TAgentPorts = {
      ...fakeAgentPorts(openedIssueEnvelope),
      run: async (request) => {
        if (request.model === 'fixture/fails') {
          return aPiResult(
            JSON.stringify({
              status: 'fail',
              summary: 'failed sibling',
              artifacts: [],
              notes_for_next_agent: '',
            }),
          )
        }
        const tracer = createTracer(
          join(dir, 'data', 'crust.db'),
          join(dir, 'poll.jsonl'),
        )
        try {
          for (let attempt = 0; attempt < 200; attempt += 1) {
            if (
              tracer
                .activityRunsFor(runId)
                .some(
                  (row) =>
                    row.params.name === 'fails-first' && row.status === 'fail',
                )
            ) {
              return aPiResult(JSON.stringify(openedIssueEnvelope))
            }
            await Bun.sleep(5)
          }
          throw new Error('failing sibling never settled')
        } finally {
          tracer.close()
        }
      },
    }
    try {
      // when, then
      await expect(
        runWorkflow(
          { ...argsFor(configPath, runId), resume: false },
          [
            {
              name: 'discover',
              strategy: 'concurrent',
              activities: ['fails-first', 'opens-later'],
            },
          ],
          ports,
          fixtureModel,
        ),
      ).rejects.toThrow('failed sibling')
      const output = plain(terminalOutput())
      const lines = output.trimEnd().split('\n')
      expect(output.split('pi-crust run complete')).toHaveLength(2)
      expect(lines[lines.findIndex((line) => line.startsWith('╰')) + 1]).toBe(
        `  issue          ${openedIssueEnvelope.issue_url}`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given use-cases/run-workflow::runWorkflow',
    'when the run throws after the session has already started',
    'it should still close the session before the error leaves the process',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    // note the resumed Activity Run's envelope on disk does not parse,
    // so replay throws from inside the fold, after `startSession` has already
    // marked this session running
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-throws-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const dataDir = join(dir, 'data')
    const dbPath = join(dataDir, 'crust.db')
    const runId = 'aabb7777'
    const sessionDir = join(dataDir, 'sessions', runId)
    mkdirSync(join(sessionDir, 'build'), { recursive: true })
    writeFileSync(join(sessionDir, 'build', 'envelope.json'), 'not json at all')
    const tracer = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    tracer.sessionStart(runId, 'tester', 'compose')
    tracer.activityRunUpsert({
      activity_run_id: `${runId}_01_build`,
      run_id: runId,
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'a row this fixture deliberately cannot replay',
      }),
      status: 'success',
      error: undefined,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.000Z',
    })
    tracer.sessionFinish(runId, false)
    tracer.close()

    // when, then
    await expect(
      runWorkflow(
        argsFor(configPath, runId),
        [{ name: 'implement', strategy: 'serial', activities: ['build'] }],
        undefined,
        fixtureModel,
      ),
    ).rejects.toThrow()
    const after = createTracer(dbPath, join(sessionDir, 'events.jsonl'))
    const state = after.activityRunsFor(runId)
    expect(state.length).toBeGreaterThan(0)
    after.close()
  },
)

test(
  [
    'given use-cases/run-workflow::runPlannedChain',
    'when the trust dial is at or above provisional',
    'it should run the planned chain and return the context it produced',
  ].join(', '),
  async () => {
    // given — resumed, with the single planned Activity's envelope already on
    // disk, so the chain replays with no agent spawned
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-planned-ok-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const { startSession } = await import('./start-session')
    const { loadConfigWithNotes } = await import(
      '../../../config/src/use-cases/load-config'
    )
    const { attemptLedger } = await import('./attempts')
    const cfg = loadConfigWithNotes(configPath).config
    const run = startSession(cfg, 'eeee5555')
    mkdirSync(join(run.sessionDir, 'build'), { recursive: true })
    writeFileSync(
      join(run.sessionDir, 'build', 'envelope.json'),
      `${JSON.stringify({
        agent_name: 'build',
        purpose: 'Build the thing',
        output_type: 'GenericOutput',
        status: 'success',
        summary: 'planned and built',
        artifacts: [],
        notes_for_next_agent: '',
      })}\n`,
    )
    /*
     * A real `--resume` reads 'build' as already done off the trace before
     * `createRun` ever runs, so `claimResume`'s credit is there to spend.
     * Mutating `run.resume` after the fact would not: `claimResume` closes
     * over the `resume` THIS `createRun` call was given, not the field a
     * later assignment replaces. Rebuilding the run with the resume set
     * already in place is what a real resumed process does.
     */
    const { createRun } = await import('./create-run')
    const resumedRun = createRun({
      cfg,
      runId: run.runId,
      tracer: run.tracer,
      engineer: run.engineer,
      resume: new Set(['build']),
      handoffDir: run.contextHandoffDir,
    })

    // when
    const actual = await runPlannedChain(
      resumedRun,
      ['build'],
      {},
      {
        run: resumedRun,
        prompt: 'x',
        previous: undefined,
        previousStep: undefined,
        upstream: [],
        cohort: [],
        baseline: '',
        outcomes: [],
        feedback: [],
      },
      argsFor(configPath, 'eeee5555'),
      50,
      attemptLedger(),
      undefined,
      fixtureModel,
    )

    // then
    expect(actual?.outcomes).toEqual([{ activity: 'build', accepted: true }])
  },
)

test(
  [
    'given use-cases/run-workflow::runPlannedChain',
    'when the trust dial is below provisional and the chain has never been replayed',
    'it should stop for a person rather than spend the budget on a chain nobody has seen',
  ].join(', '),
  async () => {
    // given
    using _environment = workflowEnvironment()
    const dir = mkdtempSync(join(tmpdir(), 'crust-run-workflow-planned-'))
    const configPath = configFor(dir, [
      {
        name: 'build',
        purpose: 'Build the thing',
        output: 'genericOutput',
        attempts: 1,
        commit: false,
      },
    ])
    const { startSession } = await import('./start-session')
    const { loadConfigWithNotes } = await import(
      '../../../config/src/use-cases/load-config'
    )
    const { attemptLedger } = await import('./attempts')
    const cfg = loadConfigWithNotes(configPath).config
    const run = startSession(cfg, 'dddd4444')

    // when
    const actual = await runPlannedChain(
      run,
      ['build'],
      {},
      {
        run,
        prompt: 'x',
        previous: undefined,
        previousStep: undefined,
        upstream: [],
        cohort: [],
        baseline: '',
        outcomes: [],
        feedback: [],
      },
      argsFor(configPath, 'dddd4444'),
      0,
      attemptLedger(),
      undefined,
      fixtureModel,
    )

    // then — nothing ran; the run is waiting on a person instead
    expect(actual).toBeUndefined()
    expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toHaveLength(1)
  },
)
