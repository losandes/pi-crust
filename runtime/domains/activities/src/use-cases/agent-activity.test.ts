/**
 * `agentActivity` with its agent call routed through an injected `TAgentPorts`
 * (COVERAGE-AGENT-PORTS.md). The intake and replay paths need no port at
 * all; the `execute` path is exercised through a fake `run` that returns a
 * prepared envelope, never a real agent.
 */

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TActivityOptions,
  TActivityRun,
  TActivityRunHandle,
  TEnvelopeBase,
  TPiCrustConfig,
  TRun,
} from '../../../../lib/contracts'
import {
  activityConfigSchema,
  activityRunParams,
  agentConfigSchema,
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
  genericOutput,
  reviewOutput,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import type { TPiResult } from '../../../agents'
import { emptyUsage } from '../../../agents'
import type { TResolvedActivity } from './activity-registry'
import { agentActivity } from './agent-activity'
import type { TAgentPorts } from './execute-agent'

const aRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-agent-activity-repo-'))
  const git = (...args: readonly string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'tester@example.com')
  git('config', 'user.name', 'tester')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'before\n')
  git('add', '-A')
  git('commit', '-qm', 'first')
  return dir
}

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

const fakePorts = (
  overrides: Readonly<Partial<TAgentPorts>> = {},
): Readonly<{ ports: TAgentPorts; calls: string[] }> => {
  const calls: string[] = []
  const runImpl =
    overrides.run ??
    (() =>
      Promise.reject(new Error('this fake was not expected to run the agent')))
  const ports: TAgentPorts = {
    changed: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push('changed')
      return []
    },
    untracked: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push('untracked')
      return []
    },
    render: (templatePath) => `rendered:${templatePath}`,
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
    ...overrides,
    run: (request, hooks) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push('run')
      return runImpl(request, hooks)
    },
  }
  return { ports, calls }
}

const aConfig = (): TPiCrustConfig =>
  crustConfigSchema.parse({
    defaults: { protected_files: [] },
    agents: [
      agentConfigSchema.parse({
        name: 'builder',
        purpose: 'build the thing',
        prompts: { system: 's.md', user: 'u.md' },
        writes: ['*'],
      }),
    ],
  }) satisfies TPiCrustConfig

const aRun = (repoRoot: string): TRun => {
  const sessionDir = mkdtempSync(
    join(tmpdir(), 'crust-agent-activity-session-'),
  )
  const contextHandoffDir = mkdtempSync(
    join(tmpdir(), 'crust-agent-activity-handoff-'),
  )
  return {
    cfg: aConfig(),
    runId: 'aaaa2222',
    engineer: 'tester',
    stream: false,
    trust: 50,
    repoRoot,
    vcsRoot: repoRoot,
    sessionDir,
    contextHandoffDir,
    resume: new Set<string>(),
    activityRuns: () => [],
    recordActivityRun: () => undefined,
    updateActivityRun: () => {
      throw new Error('not used by agentActivity')
    },
    nextSeq: () => 1,
    tokens: () => 0,
    cost: () => 0,
    addUsage: () => undefined,
    agentMap: () => ({}),
    saveAgentMap: () => undefined,
    console: {
      sessionStarted: () => undefined,
      promptReceived: () => undefined,
      sessionFinished: () => undefined,
      activityRunStarted: () => undefined,
      activityRunEnded: () => undefined,
      note: () => undefined,
      instructions: () => undefined,
      agentStarted: () => undefined,
      agentFinished: () => undefined,
      retry: () => undefined,
      gateResult: () => undefined,
      envelopeSummary: () => undefined,
      narrate: () => undefined,
    },
    tracer: {
      dbPath: ':memory:',
      event: () => 'evt',
      sessionStart: () => undefined,
      sessionWorkspace: () => undefined,
      sessionRequest: () => undefined,
      sessionWaiting: () => undefined,
      sessionFinish: () => undefined,
      sessionAddUsage: () => undefined,
      processStart: () => undefined,
      processEnd: () => undefined,
      processesEndAll: () => undefined,
      maxActivityRunSeq: () => 0,
      eventsNamed: () => [],
      activityRunsFor: () => [],
      activityRunUpsert: () => undefined,
      envelopeRow: () => undefined,
      agentSessionRow: () => undefined,
    },
  } as unknown as TRun
}

const anActivity = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
  spec: TResolvedActivity['spec'] = genericOutput,
): TResolvedActivity => ({
  config: activityConfigSchema.parse({
    name: 'build',
    purpose: 'build the thing',
    prompts: { system: 's.md', user: 'u.md' },
    output: 'genericOutput',
    input: 'upstream',
    attempts: 1,
    commit: false,
    ...overrides,
  }),
  spec,
  gates: [],
})

const aHandle = (activityRun: TActivityRun): TActivityRunHandle => ({
  activityRun,
  log: () => undefined,
})

const anActivityRun = (name = 'build'): TActivityRun => ({
  activity_run_id: `ar_${name}_1`,
  run_id: 'aaaa2222',
  seq: 1,
  params: activityRunParams({
    name,
    kind: 'agent',
    owner: 'builder',
    description: 'Build the thing',
  }),
  status: 'running',
  error: undefined,
  started_at: undefined,
  ended_at: undefined,
})

const aCtx = (
  run: TRun,
  overrides: Readonly<Partial<TActivityContext>> = {},
): TActivityContext => ({
  run,
  prompt: 'build the thing',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
  ...overrides,
})

const OPTIONS: TActivityOptions = DEFAULT_ACTIVITY_OPTIONS

const aContextEnvelope = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
): TEnvelopeBase =>
  ({
    status: 'success',
    summary: 'did the thing',
    artifacts: [],
    notes_for_next_agent: '',
    facts: [],
    decisions: [],
    assumptions: [],
    unresolved: [],
    risks: [],
    objective_met: { met: true, evidence: 'fixture' },
    regress_to: { activity: '', because: '' },
    ...overrides,
  }) as unknown as TEnvelopeBase

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    'when the incoming context carries a fact with no evidence',
    'it should throw before any agent call, naming this instance',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const run = aRun(repoRoot)
    const activity = agentActivity(anActivity(), OPTIONS)
    const { ports, calls } = fakePorts()
    const previous = aContextEnvelope({
      facts: [{ fact: 'the sky is blue', evidence: '' }],
    })
    const ctx = aCtx(run, { previous, previousStep: 'plan' })
    const handle = aHandle(anActivityRun())
    void ports

    // when, then
    await expect(activity.execute(ctx, handle)).rejects.toThrow(
      /'build' will not start/,
    )
    expect(calls).toEqual([])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    "when config.input is 'changes' and something changed since the baseline",
    'it should capture the change, log it, and hand the agent the diff as its previous envelope',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    writeFileSync(join(repoRoot, 'README.md'), 'after\n')
    const run = aRun(repoRoot)
    const logs: Record<string, unknown>[] = []
    const handle: TActivityRunHandle = {
      activityRun: anActivityRun(),
      log: (payload) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was logged is the test
        logs.push(payload)
      },
    }
    const { ports } = fakePorts({
      run: async () => aPiResult(JSON.stringify(aContextEnvelope())),
    })
    const activity = agentActivity(
      anActivity({ input: 'changes' }),
      OPTIONS,
      ports,
    )
    const was = process.cwd()
    process.chdir(repoRoot)

    try {
      // when
      const result = await activity.execute(aCtx(run), handle)

      // then
      expect(result.accepted).toBe(true)
      expect(logs[0]?.files).toBe(1)
    } finally {
      process.chdir(was)
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    "when config.input is 'changes' and nothing has changed since the baseline",
    'it should throw before any agent call',
  ].join(', '),
  async () => {
    // given — a clean repo, never touched after its first commit
    const repoRoot = aRepo()
    const run = aRun(repoRoot)
    const handle = aHandle(anActivityRun())
    const { ports, calls } = fakePorts()
    const activity = agentActivity(
      anActivity({ input: 'changes' }),
      OPTIONS,
      ports,
    )
    const was = process.cwd()
    process.chdir(repoRoot)

    try {
      // when, then
      await expect(activity.execute(aCtx(run), handle)).rejects.toThrow(
        /nothing changed since/,
      )
      expect(calls).toEqual([])
    } finally {
      process.chdir(was)
    }
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    'when replay reads a stored envelope back',
    'it should return it without spawning an agent',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const run = aRun(repoRoot)
    const activity = agentActivity(anActivity(), OPTIONS)
    const dir = join(run.sessionDir, 'build')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'envelope.json'),
      `${JSON.stringify({
        status: 'success',
        summary: 'replayed',
        artifacts: [],
        notes_for_next_agent: '',
        agent_name: 'builder',
        purpose: 'build the thing',
        output_type: 'GenericOutput',
      })}\n`,
    )

    // when
    const result = await activity.replay(aCtx(run))

    // then
    expect(result.accepted).toBe(true)
    expect((result.previous as Readonly<{ summary: string }>).summary).toBe(
      'replayed',
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    'when replay cannot read a stored envelope',
    'it should throw naming the activity run and both ways forward',
  ].join(', '),
  () => {
    // given — no envelope.json was ever written for this instance
    const repoRoot = aRepo()
    const run = aRun(repoRoot)
    const activity = agentActivity(anActivity(), OPTIONS)

    // when, then
    expect(() => activity.replay(aCtx(run))).toThrow(
      /cannot resume activityRun 'build'/,
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    'when the execute path is given an injected TAgentPorts',
    'it should call the agent through it and return the envelope it answers with',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const run = aRun(repoRoot)
    const prepared = JSON.stringify({
      status: 'success',
      summary: 'answered through the port',
      artifacts: ['context_handoff/build.md'],
      notes_for_next_agent: '',
    })
    const { ports, calls } = fakePorts({
      run: async () => aPiResult(prepared),
    })
    const activity = agentActivity(anActivity(), OPTIONS, ports)
    const handle = aHandle(anActivityRun())

    // when
    const result = await activity.execute(aCtx(run), handle)

    // then
    expect(calls).toContain('run')
    expect(result.accepted).toBe(true)
    expect((result.previous as Readonly<{ summary: string }>).summary).toBe(
      'answered through the port',
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/activities/agent-activity::agentActivity',
    'when the output type judges a change and no --base was given',
    'it should fall back to the working tree rather than the previous claim',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const run = aRun(repoRoot)
    const renders: Record<string, string>[] = []
    const { ports } = fakePorts({
      run: async () =>
        aPiResult(
          JSON.stringify({
            ...aContextEnvelope(),
            approved: true,
            findings: [],
            blocking: [],
          }),
        ),
      render: (templatePath, variables) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was rendered is the test
        renders.push({ ...variables })
        return `rendered:${templatePath}`
      },
    })
    const activity = agentActivity(
      anActivity({ output: 'reviewOutput' }, reviewOutput),
      OPTIONS,
      ports,
    )
    const previous = aContextEnvelope({ changed_files: ['builder.ts'] })
    const handle = aHandle(anActivityRun())

    // when
    const result = await activity.execute(aCtx(run, { previous }), handle)

    // then
    expect(result.accepted).toBe(true)
    expect(renders[0]?.changed_files).toBe('(none)')
    expect(renders[0]?.change_base).toBe('(the uncommitted working tree)')
  },
)

for (const entry of [
  {
    name: 'a judge with a run change',
    judge: true,
    captured: false,
    base: '',
    changed: true,
    expected: 'run.ts',
    reads: 1,
  },
  {
    name: 'a judge with no remaining run change',
    judge: true,
    captured: false,
    base: '',
    changed: false,
    expected: 'working.ts',
    reads: 1,
  },
  {
    name: 'a judge with an explicit scope',
    judge: true,
    captured: false,
    base: 'README.md',
    changed: true,
    expected: 'README.md',
    reads: 0,
  },
  {
    name: 'a non-judging Activity',
    judge: false,
    captured: false,
    base: '',
    changed: true,
    expected: 'working.ts',
    reads: 0,
  },
  {
    name: 'a judge that also captures changes',
    judge: true,
    captured: true,
    base: '',
    changed: true,
    expected: 'run.ts',
    reads: 1,
  },
  {
    name: 'a capturing judge with no remaining run change',
    judge: true,
    captured: true,
    base: '',
    changed: false,
    expected: 'README.md',
    reads: 1,
  },
  {
    name: 'a capturing judge with an explicit scope',
    judge: true,
    captured: true,
    base: 'README.md',
    changed: true,
    expected: 'README.md',
    reads: 0,
  },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given ${entry.name}`,
      'when choosing its review scope',
      'it should prefer run content only for an unscoped judge and preserve the fallback',
    ].join(', '),
    async () => {
      // given
      const repoRoot = aRepo()
      const original = aRun(repoRoot)
      const run = {
        ...original,
        tracer: {
          ...original.tracer,
          eventsNamed: (_id: string, name: string) =>
            name === 'run_start' ? [{ head: 'start-sha', tree: {} }] : [],
        },
      }
      let renders: readonly Readonly<Record<string, string>>[] = []
      let reads: readonly string[] = []
      const { ports } = fakePorts({
        changed: () => ['working.ts'],
        content: (_roots, base) => {
          reads = [...reads, base]
          return {
            status: 'ok',
            data: entry.changed ? { 'run.ts': 'hash' } : {},
          }
        },
        run: async () =>
          aPiResult(
            JSON.stringify({
              ...aContextEnvelope(),
              ...(entry.judge
                ? { approved: true, findings: [], blocking: [] }
                : {}),
            }),
          ),
        render: (path, variables) => {
          renders = [...renders, variables]
          return path
        },
      })
      const activity = agentActivity(
        anActivity(
          {
            output: entry.judge ? 'reviewOutput' : 'genericOutput',
            input: entry.captured ? 'changes' : 'upstream',
          },
          entry.judge ? reviewOutput : genericOutput,
        ),
        { ...OPTIONS, base: entry.base },
        ports,
      )
      const cwd = process.cwd()
      try {
        process.chdir(repoRoot)
        writeFileSync(join(repoRoot, 'README.md'), 'after\n')
        // when
        await activity.execute(
          aCtx(run, { baseline: 'HEAD' }),
          aHandle(anActivityRun()),
        )
        // then
        expect(renders[0]?.changed_files).toBe(entry.expected)
        expect(reads).toHaveLength(entry.reads)
        expect(renders[0]?.change_base).toBe(
          entry.base ||
            (entry.judge && entry.changed
              ? 'start-sha (HEAD when this run started). `changed_files` lists every file this run has changed since then, committed or not. Read each one with `git diff start-sha -- <path>`. A path that prints no diff is not tracked by git yet, or no longer exists: read the file itself.'
              : '(the uncommitted working tree)'),
        )
      } finally {
        process.chdir(cwd)
        rmSync(repoRoot, { recursive: true, force: true })
        rmSync(run.sessionDir, { recursive: true, force: true })
        rmSync(run.contextHandoffDir, { recursive: true, force: true })
      }
    },
  )
}
