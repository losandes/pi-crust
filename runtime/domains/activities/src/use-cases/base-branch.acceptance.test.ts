import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TActivityRunHandle,
  TPiCrustConfig,
  TRun,
  TTerminalConfig,
} from '../../../../lib/contracts'
import {
  activitiesFileSchema,
  activityConfigSchema,
  activityRunParams,
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
  genericOutput,
  reviewOutput,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { emptyUsage } from '../../../agents'
import { resolveBaseBranch, selectRange } from '../../../workspace'
import { agentActivity } from './agent-activity'
import type { TAgentPorts } from './execute-agent'
import {
  ghPullRequestActivity,
  liveDelivery,
  type TPullRequestParams,
} from './gh-pull-request'

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const shipped = activitiesFileSchema.parse(
  Bun.YAML.parse(
    readFileSync(
      join(
        import.meta.dir,
        '../../../../../templates/stamp/config/crust.activities.yaml',
      ),
      'utf8',
    ),
  ),
)
const shippedTerminal = (): TTerminalConfig => {
  const config = shipped.terminal.find((one) => one.name === 'gh-pull-request')
  if (config === undefined) throw new Error('missing shipped terminal')
  return config
}

const devRepo = (
  options: Readonly<{
    staleMain?: boolean
    tiered?: boolean
    defaultBranch?: string
    noRemote?: boolean
  }> = {},
) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-base-branch-'))
  const bare = join(root, 'remote.git')
  const seed = join(root, 'seed')
  const work = join(root, 'work')
  mkdirSync(seed)
  const defaultBranch = options.defaultBranch ?? 'dev'
  git(seed, 'init', '-q', '-b', defaultBranch)
  git(seed, 'config', 'user.email', 'tester@example.com')
  git(seed, 'config', 'user.name', 'tester')
  git(seed, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(seed, 'initial.txt'), 'initial\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'initial')
  if (options.staleMain || options.tiered) {
    git(seed, 'branch', 'main')
    writeFileSync(join(seed, 'dev.txt'), 'dev\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-qm', 'advance dev beyond main')
  }
  if (options.tiered) {
    for (const name of ['release', 'hotfix']) {
      git(seed, 'checkout', '-qb', name)
      writeFileSync(join(seed, `${name}.txt`), `${name}\n`)
      git(seed, 'add', '.')
      git(seed, 'commit', '-qm', `advance ${name}`)
    }
    git(seed, 'checkout', '-q', defaultBranch)
  }
  git(root, 'clone', '-q', '--bare', seed, bare)
  git(root, 'clone', '-q', bare, work)
  git(work, 'config', 'user.email', 'tester@example.com')
  git(work, 'config', 'user.name', 'tester')
  git(work, 'config', 'commit.gpgsign', 'false')
  git(
    work,
    'checkout',
    '-qb',
    'feature',
    options.tiered ? 'origin/hotfix' : defaultBranch,
  )
  if (options.tiered) {
    git(work, 'branch', 'release', 'origin/release')
    git(work, 'branch', 'hotfix', 'origin/hotfix')
  }
  if (options.staleMain || options.tiered)
    git(work, 'branch', 'main', 'origin/main')
  if (options.noRemote) git(work, 'remote', 'remove', 'origin')
  writeFileSync(join(work, 'feature.txt'), 'feature\n')
  git(work, 'add', '.')
  git(work, 'commit', '-qm', 'feature')
  return { root, work }
}

const cfgWith = (terminal = shippedTerminal()): TPiCrustConfig =>
  crustConfigSchema.parse({
    defaults: { protected_files: [] },
    terminal: [terminal],
    agents: [
      activityConfigSchema.parse({
        name: 'build',
        purpose: 'Implement the requested change',
        prompts: { system: 's.md', user: 'u.md' },
        writes: ['*'],
      }),
    ],
  })

const aRun = (root: string, work: string, cfg = cfgWith()): TRun => {
  const sessionDir = join(root, 'session')
  const contextHandoffDir = join(root, 'handoff')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(contextHandoffDir, { recursive: true })
  return {
    cfg: {
      ...cfg,
      observability: { ...cfg.observability, db: join(root, 'absent.db') },
    },
    runId: 'aaaa2222',
    engineer: 'tester',
    stream: false,
    trust: 50,
    repoRoot: work,
    vcsRoot: work,
    sessionDir,
    contextHandoffDir,
    resume: new Set(['gh-pull-request']),
    activityRuns: () => [],
    recordActivityRun: () => undefined,
    updateActivityRun: () => undefined,
    nextSeq: () => 1,
    tokens: () => 0,
    cost: () => 0,
    addUsage: () => undefined,
    agentMap: () => ({}),
    saveAgentMap: () => undefined,
    console: {
      note: () => undefined,
      agentStarted: () => undefined,
      agentFinished: () => undefined,
      retry: () => undefined,
      envelopeSummary: () => undefined,
      gateResult: () => undefined,
    },
    tracer: {
      event: () => 'evt',
      processStart: () => undefined,
      processEnd: () => undefined,
      agentSessionRow: () => undefined,
      envelopeRow: () => undefined,
      gateRow: () => undefined,
      eventsNamed: () => [],
      sessionAddUsage: () => undefined,
    },
  } as unknown as TRun
}
const ctxFor = (run: TRun): TActivityContext => ({
  run,
  prompt: 'build',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})
const aHandle = (logs: Record<string, unknown>[] = []): TActivityRunHandle => ({
  activityRun: {
    activity_run_id: 'ar_build_1',
    run_id: 'aaaa2222',
    seq: 1,
    params: activityRunParams({
      name: 'build',
      kind: 'agent',
      owner: 'build',
      description: 'Implement the requested change',
    }),
    status: 'running',
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
  },
  log: (payload) => {
    // biome-ignore lint/plugin/no-array-mutation: recording the measurement passed to the Activity handle is the assertion boundary
    logs.push(payload)
  },
})
const deliver = async (run: TRun, terminal = shippedTerminal()) => {
  const created: TPullRequestParams[] = []
  const pushes: string[] = []
  const updated: TPullRequestParams[] = []
  const events: Readonly<Record<string, unknown>>[] = []
  const traced = {
    ...run,
    tracer: {
      ...run.tracer,
      event: (event: Readonly<Record<string, unknown>>) => {
        // biome-ignore lint/plugin/no-array-mutation: recording the trace payload is the test
        events.push(event)
        return 'evt'
      },
    },
  }
  const result = await ghPullRequestActivity(
    terminal,
    DEFAULT_ACTIVITY_OPTIONS,
    {
      ...liveDelivery,
      push: (_remote, branch) => {
        // biome-ignore lint/plugin/no-array-mutation: recording calls proves refusal prevents pushing
        pushes.push(branch)
      },
      forge: {
        authenticated: () => true,
        whoami: () => 'tester',
        find: () => '',
        create: (params) => {
          // biome-ignore lint/plugin/no-array-mutation: recording the forge boundary is the test
          created.push(params)
          return 'https://example.com/pull/1'
        },
        update: (_url, params) => {
          // biome-ignore lint/plugin/no-array-mutation: recording calls proves refusal prevents updating
          updated.push(params)
          return 'https://example.com/pull/1'
        },
      },
    },
  ).deliver(ctxFor(traced), aHandle())
  return { result, created, pushes, updated, events }
}
const execute = async (
  run: TRun,
  judge: boolean,
  base = '',
  baseline = '',
  calls: string[] = [],
) => {
  const renders: Readonly<Record<string, string>>[] = []
  const logs: Record<string, unknown>[] = []
  const ports: TAgentPorts = {
    changed: () => [],
    untracked: () => [],
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
    render: (_path, variables) => {
      // biome-ignore lint/plugin/no-array-mutation: recording the agent input is the test
      renders.push(variables)
      return 'prompt'
    },
    savePrompt: (dir, name) => join(dir, name),
    run: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording calls proves failure prevents spawning an agent
      calls.push('run')
      return Promise.resolve({
        text: JSON.stringify({
          status: 'success',
          summary: 'done',
          artifacts: [],
          notes_for_next_agent: '',
          facts: [],
          decisions: [],
          assumptions: [],
          unresolved: [],
          risks: [],
          objective_met: { met: true, evidence: 'fixture' },
          regress_to: { activity: '', because: '' },
          ...(judge ? { approved: true, findings: [], blocking: [] } : {}),
        }),
        returncode: 0,
        sessionId: 's1',
        tokens: 0,
        cost: 0,
        usage: emptyUsage,
        contextTokens: 0,
        contextWindow: 0,
      })
    },
  }
  const activity = agentActivity(
    {
      config: activityConfigSchema.parse({
        name: 'build',
        purpose: 'Implement the requested change',
        prompts: { system: 's.md', user: 'u.md' },
        output: judge ? 'reviewOutput' : 'genericOutput',
        input: judge ? 'upstream' : 'changes',
        commit: false,
      }),
      spec: judge ? reviewOutput : genericOutput,
      gates: [],
    },
    { ...DEFAULT_ACTIVITY_OPTIONS, base },
    ports,
  )
  await activity.execute({ ...ctxFor(run), baseline }, aHandle(logs))
  return { renders, logs, calls }
}

for (const scenario of [2, 3, 4, 5]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC${scenario} a clone whose default branch is dev and has no main`,
      `when ${scenario === 2 ? 'delivering feature' : scenario === 3 ? 'delivering dev itself' : scenario === 4 ? 'measuring the run without a baseline' : 'judging an omitted-left range'}`,
      'it should use dev without any operator configuration',
    ].join(', '),
    async () => {
      // given
      const { root, work } = devRepo()
      const cwd = process.cwd()
      try {
        process.chdir(work)
        expect(git(work, 'branch', '-a')).not.toContain('main')
        const run = aRun(root, work)
        if (scenario === 3) git(work, 'checkout', '-q', 'dev')
        // when
        if (scenario === 2 || scenario === 3) {
          const actual = await deliver(run)
          // then
          if (scenario === 2) {
            expect(actual.result.action).not.toBe('refused')
            expect(actual.created[0]?.base).toBe('dev')
          } else {
            expect(actual.result.action).toBe('refused')
            expect(actual.result.reason).toContain("base branch 'dev'")
            expect(actual.pushes).toEqual([])
            expect(actual.created).toEqual([])
            expect(actual.updated).toEqual([])
          }
        } else if (scenario === 4) {
          const actual = await execute(run, false)
          // then
          expect(actual.logs[0]?.base).toMatch(/^dev @/)
          expect(actual.logs[0]?.reason).toContain('dev')
          expect(actual.renders[0]?.changed_files).toBe('feature.txt')
        } else {
          const explicit = await execute(run, true, 'dev...HEAD')
          const actual = await execute(run, true, '...HEAD')
          // then
          expect(actual.renders[0]?.changed_files).toBe(
            explicit.renders[0]?.changed_files,
          )
          expect(actual.renders[0]?.changed_files).toBe('feature.txt')
        }
      } finally {
        process.chdir(cwd)
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

for (const scenario of [2, 3, 4, 5]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC7 a dev clone with main older than dev (SC${scenario})`,
      'when delivering, measuring or judging with no explicit base',
      'it should ignore both main and origin/main',
    ].join(', '),
    async () => {
      // given
      const { root, work } = devRepo({ staleMain: true })
      const cwd = process.cwd()
      try {
        process.chdir(work)
        const run = aRun(root, work)
        expect(git(work, 'rev-parse', 'main')).not.toBe(
          git(work, 'rev-parse', 'dev'),
        )
        expect(git(work, 'rev-parse', 'origin/main')).toBe(
          git(work, 'rev-parse', 'main'),
        )
        if (scenario === 3) git(work, 'checkout', '-q', 'dev')
        // when
        if (scenario === 2 || scenario === 3) {
          const actual = await deliver(run)
          // then
          expect(JSON.stringify(actual)).not.toContain('main')
          if (scenario === 2) {
            expect(actual.result.action).toBe('created')
            expect(actual.created[0]?.base).toBe('dev')
          } else {
            expect(actual.result.action).toBe('refused')
            expect(actual.result.reason).toContain("base branch 'dev'")
            expect(actual.pushes).toEqual([])
            expect(actual.created).toEqual([])
          }
        } else if (scenario === 4) {
          const actual = await execute(run, false)
          // then
          expect(actual.logs[0]?.base).toMatch(/^dev @/)
          expect(actual.logs[0]?.reason).toContain('dev')
          expect(JSON.stringify(actual.logs)).not.toContain('main')
          expect(actual.renders[0]?.changed_files).toBe('feature.txt')
        } else {
          const explicit = await execute(run, true, 'dev...HEAD')
          const actual = await execute(run, true, '...HEAD')
          // then
          expect(actual.renders[0]?.changed_files).toBe(
            explicit.renders[0]?.changed_files,
          )
          expect(actual.renders[0]?.changed_files).toBe('feature.txt')
          expect(JSON.stringify(actual.logs)).not.toContain('main')
        }
      } finally {
        process.chdir(cwd)
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

for (const staleMain of [false, true]) {
  for (const separator of ['..', '...']) {
    test.skipIf(SKIP_INTEGRATION)(
      [
        `given @SC5 @SC7 a dev clone ${staleMain ? 'with stale main' : 'without main'}`,
        `when selecting ${separator}HEAD and dev${separator}HEAD`,
        'it should record identical completed endpoints, nonempty paths and reason',
      ].join(', '),
      () => {
        // given
        const { root, work } = devRepo({ staleMain })
        const cwd = process.cwd()
        try {
          process.chdir(work)
          const select = selectRange(resolveBaseBranch(cfgWith(), ''))
          // when
          const actual = select(`${separator}HEAD`)
          const explicit = select(`dev${separator}HEAD`)
          // then
          expect({ ...actual, spec: '' }).toEqual({ ...explicit, spec: '' })
          expect(actual.paths).toEqual(['feature.txt'])
          expect(actual.from).toBe('dev')
          expect(actual.to).toBe('HEAD')
          expect(actual.reason).toContain('dev')
          expect(actual.reason).not.toContain('main')
        } finally {
          process.chdir(cwd)
          rmSync(root, { recursive: true, force: true })
        }
      },
    )
  }
}

const tiers = [
  {
    source: 'flag',
    name: 'hotfix',
    phrase: 'named by the --scope flag',
    paths: ['feature.txt'],
  },
  {
    source: 'configuration',
    name: 'release',
    phrase: 'named by delivery.base in configuration',
    paths: ['feature.txt', 'hotfix.txt'],
  },
  {
    source: 'remote-default',
    name: 'dev',
    phrase: "the default branch remote 'origin' declares",
    paths: ['feature.txt', 'hotfix.txt', 'release.txt'],
  },
  {
    source: 'built-in',
    name: 'main',
    phrase:
      "the built-in fallback: nothing named a base branch and remote 'origin' declares no default",
    paths: ['dev.txt', 'feature.txt', 'hotfix.txt', 'release.txt'],
  },
] as const
const terminalForTier = (source: string, missing = false): TTerminalConfig => {
  const original = shippedTerminal()
  const configured = source === 'flag' || source === 'configuration'
  return {
    ...original,
    delivery: {
      ...original.delivery,
      base: configured
        ? missing && source === 'configuration'
          ? 'gone'
          : 'release'
        : undefined,
    },
  }
}

for (const operation of ['delivery', 'measurement', 'range']) {
  for (const tier of tiers.filter(
    (one) => operation !== 'delivery' || one.source !== 'flag',
  )) {
    test.skipIf(SKIP_INTEGRATION)(
      [
        `given @SC6 ${operation} with ${tier.source} as the first available tier`,
        'when resolving among distinct main, dev, release and hotfix commits',
        `it should report ${tier.name} and select its own distinct change`,
      ].join(', '),
      async () => {
        // given
        const { root, work } = devRepo({ tiered: true })
        const cwd = process.cwd()
        try {
          process.chdir(work)
          if (tier.source === 'built-in')
            git(work, 'remote', 'set-head', 'origin', '--delete')
          const terminal = terminalForTier(tier.source)
          const cfg = cfgWith(terminal)
          const run = aRun(root, work, cfg)
          // when
          if (operation === 'delivery') {
            const actual = await deliver(run, terminal)
            // then
            expect(actual.result.action).toBe('created')
            expect(actual.created[0]?.base).toBe(tier.name)
            expect(actual.events.at(-1)?.payload).toMatchObject({
              base: tier.name,
            })
          } else if (operation === 'measurement') {
            const actual = await execute(
              run,
              false,
              tier.source === 'flag' ? 'hotfix' : '',
            )
            // then
            expect(actual.logs[0]?.base).toMatch(new RegExp(`^${tier.name} @`))
            expect(actual.logs[0]?.reason).toContain(tier.name)
            expect(actual.renders[0]?.changed_files).toBe(tier.paths.join('\n'))
          } else {
            const scope = tier.source === 'flag' ? 'hotfix...HEAD' : '...HEAD'
            const actual = await execute(run, true, scope)
            const selection = selectRange(resolveBaseBranch(cfg, ''))(scope)
            // then
            expect(selection.from).toBe(tier.name)
            expect(selection.reason).toContain(tier.name)
            expect(actual.renders[0]?.changed_files).toBe(tier.paths.join('\n'))
          }
        } finally {
          process.chdir(cwd)
          rmSync(root, { recursive: true, force: true })
        }
      },
    )

    test.skipIf(SKIP_INTEGRATION)(
      [
        `given @SC8 ${operation} with a missing branch from ${tier.source}`,
        'when the resolved name cannot be used',
        'it should stop with the branch and tier instead of substituting another ref',
      ].join(', '),
      async () => {
        // given
        const { root, work } = devRepo({ tiered: true })
        const cwd = process.cwd()
        try {
          process.chdir(work)
          if (tier.source === 'built-in') {
            git(work, 'remote', 'set-head', 'origin', '--delete')
            git(work, 'branch', '-D', 'main')
            git(work, 'update-ref', '-d', 'refs/remotes/origin/main')
          }
          if (tier.source === 'remote-default')
            git(
              work,
              'symbolic-ref',
              'refs/remotes/origin/HEAD',
              'refs/remotes/origin/gone',
            )
          const missing = tier.source === 'built-in' ? 'main' : 'gone'
          const terminal = terminalForTier(tier.source, true)
          const cfg = cfgWith(terminal)
          const run = aRun(root, work, cfg)
          const calls: string[] = []
          // when, then
          if (operation === 'delivery') {
            const actual = await deliver(run, terminal)
            expect(actual.result.action).toBe('refused')
            expect(actual.result.reason).toContain(`base branch '${missing}'`)
            expect(actual.result.reason).toContain(tier.phrase)
            expect(actual.pushes).toEqual([])
            expect(actual.created).toEqual([])
            expect(actual.updated).toEqual([])
            expect(actual.events.at(-1)?.payload).toMatchObject({
              base: missing,
            })
          } else if (operation === 'measurement') {
            const actual = execute(
              run,
              false,
              tier.source === 'flag' ? 'gone' : '',
              '',
              calls,
            )
            await expect(actual).rejects.toThrow(`base ref '${missing}'`)
            await expect(actual).rejects.toThrow(tier.phrase)
            expect(calls).toEqual([])
          } else {
            const scope = tier.source === 'flag' ? 'gone...HEAD' : '...HEAD'
            const actual = () => selectRange(resolveBaseBranch(cfg, ''))(scope)
            expect(actual).toThrow(`base ref '${missing}'`)
            expect(actual).toThrow(tier.phrase)
            await expect(execute(run, true, scope, '', calls)).rejects.toThrow(
              tier.phrase,
            )
            expect(calls).toEqual([])
          }
        } finally {
          process.chdir(cwd)
          rmSync(root, { recursive: true, force: true })
        }
      },
    )
  }
}

for (const noRemote of [false, true]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given @SC9 main as the default ${noRemote ? 'without a remote' : 'in a clone'}`,
      'when selecting an omitted-left range and delivering',
      'it should keep main as the base and retain the remote-exists precondition',
    ].join(', '),
    async () => {
      // given
      const { root, work } = devRepo({ defaultBranch: 'main', noRemote })
      const cwd = process.cwd()
      try {
        process.chdir(work)
        const cfg = cfgWith()
        const run = aRun(root, work, cfg)
        const select = selectRange(resolveBaseBranch(cfg, ''))
        // when
        const actual = select('...HEAD')
        const explicit = select('main...HEAD')
        const delivery = await deliver(run)
        const measurement = await execute(run, false)
        // then
        expect({ ...actual, spec: '' }).toEqual({ ...explicit, spec: '' })
        expect(actual.paths).toEqual(['feature.txt'])
        expect(actual.from).toBe('main')
        expect(measurement.logs[0]?.base).toMatch(/^main @/)
        expect(delivery.events.at(-1)?.payload).toMatchObject({ base: 'main' })
        if (noRemote) {
          expect(delivery.result.action).toBe('refused')
          expect(delivery.result.reason).toContain('not a configured remote')
          expect(delivery.pushes).toEqual([])
        } else {
          expect(delivery.result.action).toBe('created')
          expect(delivery.created[0]?.base).toBe('main')
        }
      } finally {
        process.chdir(cwd)
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given @SC9 a recorded run baseline and a conflicting explicit base',
    'when measuring the change',
    'it should keep the pinned baseline ahead of all branch tiers',
  ].join(', '),
  async () => {
    // given
    const { root, work } = devRepo({ tiered: true })
    const cwd = process.cwd()
    try {
      process.chdir(work)
      const run = aRun(root, work, cfgWith(terminalForTier('configuration')))
      // when
      const actual = await execute(
        run,
        false,
        'gone',
        git(work, 'rev-parse', 'hotfix'),
      )
      // then
      expect(actual.renders[0]?.changed_files).toBe('feature.txt')
      expect(actual.logs[0]?.base).toMatch(/^[a-f0-9]{7} @/)
    } finally {
      process.chdir(cwd)
      rmSync(root, { recursive: true, force: true })
    }
  },
)
