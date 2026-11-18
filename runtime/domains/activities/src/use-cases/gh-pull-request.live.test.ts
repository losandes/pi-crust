/**
 * Covers the one branch `gh-pull-request.test.ts` cannot reach without
 * injecting the agent call itself: the LIVE (non-`--resume`) path through
 * `deliver()`, where `callAgent` is actually invoked rather than an
 * already-stored envelope being read back with `readEnvelope` (1.6.7).
 *
 * `ghPullRequestActivity` takes a `TAgentPorts` (COVERAGE-AGENT-PORTS.md),
 * so the agent half is faked the same way `TDeliveryPorts` fakes the git and
 * `gh` half below — no module-registry override, and nothing here spawns a
 * coding agent, a git subprocess, or any other child process.
 */

import { expect, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TActivityOptions,
  TActivityRunHandle,
  TRun,
  TTerminalConfig,
} from '../../../../lib/contracts'
import {
  agentConfigSchema,
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
  terminalConfigSchema,
} from '../../../../lib/contracts'
import type { TPiResult } from '../../../agents'
import { emptyUsage } from '../../../agents'
import type { TAgentPorts } from './execute-agent'
import type { TDeliveryPorts, TForge } from './gh-pull-request'
import { ghPullRequestActivity, liveDelivery } from './gh-pull-request'

const config = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
): TTerminalConfig =>
  terminalConfigSchema.parse({
    name: 'gh-pull-request',
    purpose: 'Push the run and open or update a pull request',
    writes: [],
    prompt_engineering: { system: 's.md', user: 'u.md' },
    delivery: { remote: 'origin', base: 'main', draft: false },
    ...overrides,
  })

const fakeForge = (
  overrides: Readonly<Partial<TForge>> = {},
): Readonly<{ forge: TForge; calls: Record<string, unknown>[] }> => {
  const calls: Record<string, unknown>[] = []
  const forge: TForge = {
    authenticated: () => true,
    whoami: () => 'octocat',
    find: (branch) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'find', branch })
      return ''
    },
    create: (params) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'create', params })
      return 'https://example.com/owner/repo/pull/1'
    },
    update: (url, params) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'update', url, params })
      return url
    },
    ...overrides,
  }
  return { forge, calls }
}

const fakePorts = (
  overrides: Readonly<Partial<TDeliveryPorts>> = {},
  forgeOverrides: Readonly<Partial<TForge>> = {},
): Readonly<{ ports: TDeliveryPorts; calls: Record<string, unknown>[] }> => {
  const { forge, calls } = fakeForge(forgeOverrides)
  const ports: TDeliveryPorts = {
    defaultBranch: () => '',
    isRepo: () => true,
    branch: () => 'feature',
    remoteExists: () => true,
    baseRef: () => 'refs/remotes/origin/main',
    commitsAhead: () => 1,
    uncommitted: () => [],
    push: (remote, branch) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'push', remote, branch })
    },
    forge,
    ...overrides,
  }
  return { ports, calls }
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

/** A `TAgentPorts` whose `run` is the only member any test here overrides. */
const fakeAgentPorts = (run: TAgentPorts['run']): TAgentPorts => ({
  run,
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

const CONTEXT_ENVELOPE_DEFAULTS = {
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
  artifacts: [],
  notes_for_next_agent: '',
}

const aRun = (overrides: Readonly<Partial<TRun>> = {}): TRun => {
  const contextHandoffDir = mkdtempSync(
    join(tmpdir(), 'crust-gh-pr-live-handoff-'),
  )
  const sessionDir = mkdtempSync(join(tmpdir(), 'crust-gh-pr-live-session-'))
  return {
    runId: 'ffff6666',
    engineer: 'tester',
    repoRoot: '/does-not-matter',
    vcsRoot: '/does-not-matter',
    sessionDir,
    contextHandoffDir,
    resume: new Set<string>(),
    cfg: crustConfigSchema.parse({
      agents: [
        agentConfigSchema.parse({
          name: 'gh-pull-request',
          writes: [],
          prompt_engineering: { system: 's.md', user: 'u.md' },
          purpose: 'Push the run and open or update a pull request',
        }),
      ],
      observability: { db: join(contextHandoffDir, 'no-such.db') },
      defaults: {
        data_dir: join(contextHandoffDir, 'runtime'),
        protected_files: [],
      },
    }),
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
    addUsage: () => undefined,
    agentMap: () => ({}),
    saveAgentMap: () => undefined,
    ...overrides,
  } as unknown as TRun
}

const aHandle = (): TActivityRunHandle =>
  ({
    activityRun: {
      activity_run_id: 'id_gh-pull-request-live',
      params: {
        kind: 'agent',
        owner: 'gh-pull-request',
        name: 'gh-pull-request',
      },
    },
    log: () => undefined,
  }) as unknown as TActivityRunHandle

const aCtx = (
  run: TRun,
  extra: Readonly<Partial<TActivityContext>> = {},
): TActivityContext =>
  ({
    run,
    prompt: 'ship the feature',
    previous: undefined,
    previousStep: undefined,
    upstream: [],
    cohort: [],
    baseline: '',
    outcomes: [],
    feedback: [],
    ...extra,
  }) as unknown as TActivityContext

const OPTIONS: TActivityOptions = DEFAULT_ACTIVITY_OPTIONS

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when run.resume does NOT name this Activity and the agent call succeeds',
    'it should deliver the agent-composed title and body, not the trace-generated draft',
  ].join(', '),
  async () => {
    // given — no `run.resume` entry, so deliver() takes the live callAgent
    // branch (gh-pull-request.ts) instead of readEnvelope (1.6.7)
    const agentPorts = fakeAgentPorts(async () =>
      aPiResult(
        JSON.stringify({
          ...CONTEXT_ENVELOPE_DEFAULTS,
          status: 'success',
          summary: 'opened the PR',
          title: 'Ship the live-path feature',
          body: 'This is the agent-composed body, not a fallback.',
        }),
      ),
    )
    const { ports, calls } = fakePorts()
    const activity = ghPullRequestActivity(config(), OPTIONS, ports, agentPorts)
    const run = aRun()

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.action).toEqual('created')
    expect(actual.fallback).toBe(false)
    const created = calls.find((one) => one.op === 'create') as
      | { params: { title: string } }
      | undefined
    expect(created?.params.title).toEqual('Ship the live-path feature')
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when run.resume does NOT name this Activity and the agent call throws',
    'it should deliver the trace-generated draft, flag the fallback, and still succeed',
  ].join(', '),
  async () => {
    // given
    const agentPorts = fakeAgentPorts(() =>
      Promise.reject(new Error('agent process exited 1')),
    )
    const { ports, calls } = fakePorts()
    const activity = ghPullRequestActivity(config(), OPTIONS, ports, agentPorts)
    const run = aRun()

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then — the activity run itself never throws, 1.6.5
    expect(actual.action).toEqual('created')
    expect(actual.fallback).toBe(true)
    expect(calls.map((one) => one.op)).toEqual(['push', 'find', 'create'])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::liveDelivery',
    'when every git and gh operation it can perform runs',
    'it should never construct --force, -f or --force-with-lease (1.5.4)',
  ].join(', '),
  () => {
    // given — spy the one function both git.ts and this module's own `gh`
    // wiring call through: the real argv passed to the process, not a typed
    // port a fake could paper over.
    const recorded: string[][] = []
    const spy = spyOn(childProcess, 'spawnSync').mockImplementation(((
      _command: string,
      args?: readonly string[],
    ) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      recorded.push([...(args ?? [])])
      return { status: 0, stdout: '', stderr: '' }
    }) as typeof childProcess.spawnSync)

    try {
      // when — every liveDelivery operation this Activity can invoke,
      // exercised directly against the real (spied) process boundary
      liveDelivery.defaultBranch('origin', '/does-not-matter')
      liveDelivery.isRepo('/does-not-matter')
      liveDelivery.branch('/does-not-matter')
      liveDelivery.remoteExists('origin', '/does-not-matter')
      liveDelivery.baseRef('origin', 'main', '/does-not-matter')
      liveDelivery.commitsAhead('main', 'feature', '/does-not-matter')
      // biome-ignore lint/plugin/no-array-mutation: liveDelivery's own push port, not Array.prototype.push
      liveDelivery.push('origin', 'feature', '/does-not-matter')
      liveDelivery.forge.authenticated('/does-not-matter')
      liveDelivery.forge.whoami('/does-not-matter')
      liveDelivery.forge.find('feature', '/does-not-matter')
      liveDelivery.forge.create(
        {
          title: 'T',
          bodyPath: '/tmp/body.md',
          base: 'main',
          branch: 'feature',
          draft: false,
        },
        '/does-not-matter',
      )
      liveDelivery.forge.update(
        'https://example.com/owner/repo/pull/1',
        {
          title: 'T',
          bodyPath: '/tmp/body.md',
          base: 'main',
          branch: 'feature',
          draft: false,
        },
        '/does-not-matter',
      )
    } finally {
      spy.mockRestore()
    }

    // then
    expect(recorded.length).toBeGreaterThan(0)
    for (const argv of recorded) {
      expect(argv).not.toContain('--force')
      expect(argv).not.toContain('-f')
      expect(argv).not.toContain('--force-with-lease')
    }
  },
)
