import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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
  activityRunParams,
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
  terminalConfigSchema,
} from '../../../../lib/contracts'
import { ensureDir, readText, writeText } from '../../../../lib/system'
import { emptyUsage, render } from '../../../agents'
import type { TAgentPorts } from './execute-agent'
import type {
  TDeliveryPorts,
  TForge,
  TPullRequestParams,
} from './gh-pull-request'
import {
  attributedBody,
  fallbackPullRequest,
  ghPullRequestActivity,
} from './gh-pull-request'

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

/** Every argv-shaped call a fake forge recorded, so a test can prove it was never reached. */
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

const aRun = (overrides: Readonly<Partial<TRun>> = {}): TRun => {
  const contextHandoffDir = mkdtempSync(join(tmpdir(), 'crust-gh-pr-handoff-'))
  const sessionDir = mkdtempSync(join(tmpdir(), 'crust-gh-pr-session-'))
  return {
    runId: 'eeee5555',
    engineer: 'tester',
    vcsRoot: '/does-not-matter',
    sessionDir,
    contextHandoffDir,
    resume: new Set<string>(),
    cfg: {
      observability: { db: join(contextHandoffDir, 'no-such.db') },
      routing: { skills: [], checks: [], unmatched: 'warn' },
    },
    console: { note: () => undefined },
    tracer: { event: () => undefined },
    ...overrides,
  } as unknown as TRun
}

const aHandle = (): TActivityRunHandle =>
  ({
    activityRun: { activity_run_id: 'id_gh-pull-request' },
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

const resumedEnvelope = (
  run: TRun,
  body: Readonly<Record<string, unknown>>,
): void => {
  const dir = join(run.sessionDir, 'gh-pull-request')
  ensureDir(dir)
  writeText(
    join(dir, 'envelope.json'),
    JSON.stringify({ ...CONTEXT_ENVELOPE_DEFAULTS, ...body }),
  )
}

const OPTIONS: TActivityOptions = DEFAULT_ACTIVITY_OPTIONS

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when --commit false was in force',
    'it should refuse without pushing or calling the forge',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts()
    const activity = ghPullRequestActivity(
      config(),
      { ...OPTIONS, committing: false },
      ports,
    )
    const run = aRun()

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/--commit false/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the workspace is not a git repository',
    'it should refuse',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({ isRepo: () => false })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)

    // when
    const actual = await activity.deliver(aCtx(aRun()), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/not a git repository|HEAD is detached/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the current branch IS delivery.base',
    'it should refuse, because pi-crust does not create branches',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({ branch: () => 'main' })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)

    // when
    const actual = await activity.deliver(aCtx(aRun()), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/IS delivery.base/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when delivery.remote is not configured',
    'it should refuse',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({ remoteExists: () => false })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)

    // when
    const actual = await activity.deliver(aCtx(aRun()), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/is not a configured remote/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when neither the remote-tracking ref nor the local base resolves',
    'it should refuse',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({ baseRef: () => '' })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)

    // when
    const actual = await activity.deliver(aCtx(aRun()), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/resolves to a commit/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the branch is not ahead of delivery.base',
    'it should refuse',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({ commitsAhead: () => 0 })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)

    // when
    const actual = await activity.deliver(aCtx(aRun()), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/not ahead of/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    "when 'gh' is not installed or 'gh auth status' fails",
    'it should refuse',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({}, { authenticated: () => false })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)

    // when
    const actual = await activity.deliver(aCtx(aRun()), aHandle())

    // then
    expect(actual.action).toEqual('refused')
    expect(actual.reason).toMatch(/not installed|auth status/)
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when every precondition holds and the resumed envelope is usable',
    'it should push the branch, find no open PR, and create one',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts()
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'success',
      summary: 'done',
      title: 'Ship the feature',
      body: 'This does the thing.',
    })

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.action).toEqual('created')
    expect(actual.fallback).toBe(false)
    expect(calls.map((one) => one.op)).toEqual(['push', 'find', 'create'])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the forge already has an open pull request for this branch',
    'it should update it rather than creating a second one',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts(
      {},
      {
        find: (branch) => {
          // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
          calls.push({ op: 'find', branch })
          return 'https://example.com/owner/repo/pull/9'
        },
      },
    )
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'success',
      summary: 'done',
      title: 'Ship the feature',
      body: 'This does the thing.',
    })

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.action).toEqual('updated')
    expect(actual.url).toEqual('https://example.com/owner/repo/pull/9')
    expect(calls.map((one) => one.op)).toEqual(['push', 'find', 'update'])
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the stored envelope cannot be read',
    'it should deliver the trace-generated draft and still succeed',
  ].join(', '),
  async () => {
    // given — resume names this Activity, but no envelope was ever written
    const { ports } = fakePorts()
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.fallback).toBe(true)
    expect(actual.action).toEqual('created')
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the resumed envelope reports status: fail',
    'it should deliver the trace-generated draft and still succeed',
  ].join(', '),
  async () => {
    // given
    const { ports } = fakePorts()
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'fail',
      summary: 'could not compose',
      title: '',
      body: '',
    })

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.fallback).toBe(true)
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the resumed envelope answers with an empty title',
    'it should deliver the trace-generated draft and still succeed',
  ].join(', '),
  async () => {
    // given
    const { ports } = fakePorts()
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'success',
      summary: 'done',
      title: '   ',
      body: 'a real body',
    })

    // when
    const actual = await activity.deliver(aCtx(run), aHandle())

    // then
    expect(actual.fallback).toBe(true)
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when a body is delivered',
    'it should carry the AI-authorship attribution block',
  ].join(', '),
  async () => {
    // given
    let created: TPullRequestParams | undefined
    const { ports } = fakePorts(
      {},
      {
        create: (params) => {
          created = params
          return 'https://example.com/owner/repo/pull/1'
        },
      },
    )
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'success',
      summary: 'done',
      title: 'Ship the feature',
      body: 'This does the thing.',
    })

    // when
    await activity.deliver(aCtx(run), aHandle())

    // then
    const body = readText(created?.bodyPath ?? '')
    expect(body).toMatch(/Written by pi-crust \(an AI coding agent running/)
    expect(body).toMatch(/on behalf of @octocat/)
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the run prompt names an issue',
    'it should carry a closing keyword and a Checks section, and title the issue suffix',
  ].join(', '),
  async () => {
    // given
    let created: TPullRequestParams | undefined
    const { ports } = fakePorts(
      {},
      {
        create: (params) => {
          created = params
          return 'https://example.com/owner/repo/pull/1'
        },
      },
    )
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'success',
      summary: 'done',
      title: 'Ship the feature',
      body: 'This does the thing.\n\ncloses #999\n\n## Checks\n\n- [x] a lie',
    })

    // when
    await activity.deliver(
      aCtx(run, { prompt: 'ship it, closes #54' }),
      aHandle(),
    )

    // then
    const body = readText(created?.bodyPath ?? '')
    expect(body).toMatch(/closes #54/)
    expect(body).not.toMatch(/closes #999/)
    expect(body).toContain('## Checks')
    expect(body).not.toContain('a lie')
    expect(created?.title).toEqual('Ship the feature (#54)')
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::ghPullRequestActivity',
    'when the agent call fails and the harness falls back to the trace-generated draft',
    'it should still deliver a body carrying Activities and Checks',
  ].join(', '),
  async () => {
    // given
    let created: TPullRequestParams | undefined
    const { ports } = fakePorts(
      {},
      {
        create: (params) => {
          created = params
          return 'https://example.com/owner/repo/pull/1'
        },
      },
    )
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'fail',
      summary: 'could not compose',
      title: '',
      body: '',
    })

    // when
    await activity.deliver(aCtx(run), aHandle())

    // then — this fixture's db does not exist, so the run has no recorded
    // state and '## Activities' has nothing to render (1.3.1); '## Checks'
    // always renders, down to its working-tree line (1.4.5).
    const body = readText(created?.bodyPath ?? '')
    expect(body).toContain('## Checks')
    expect(body).toContain('every change committed')
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::fallbackPullRequest',
    'when given a prompt, a reason and no trace state',
    'it should produce a title and a body that names the reason',
  ].join(', '),
  () => {
    // given
    const given = {
      runId: 'ffff6666',
      prompt: 'add the widget',
      because: 'the agent never answered',
      state: undefined,
      declaredChecks: [],
      uncommitted: [],
      composedBy: 'gh-pull-request',
    }

    // when
    const actual = fallbackPullRequest(given)

    // then
    expect(actual.title).toEqual('add the widget')
    expect(actual.body).toMatch(/the agent never answered/)
  },
)

test(
  [
    'given use-cases/activities/gh-pull-request::attributedBody',
    'when a login is known',
    'it should name it both before and after the body',
  ].join(', '),
  () => {
    // given
    const login = 'octocat'

    // when
    const actual = attributedBody('the body', 'openai/gpt-5', login)

    // then
    expect(actual).toMatch(
      /^> Written by pi-crust \(an AI coding agent running openai\/gpt-5\) on behalf of @octocat\./,
    )
    expect(actual).toMatch(/— pi-crust, on behalf of @octocat\.$/)
    expect(actual).toContain('the body')
  },
)

test(
  [
    'given issue #108 requirement 1.5.2 and two verdicts after built work',
    'when gh-pull-request composes its shipped prompt at the agent boundary',
    'it should still receive both complete verdicts alongside the superseding work',
  ].join(', '),
  async () => {
    // given
    const base = aRun()
    const terminal = config({
      prompt_engineering: {
        system: join(
          import.meta.dir,
          '../../../../prompt-engineering/gh-pull-request/system.md',
        ),
        user: join(
          import.meta.dir,
          '../../../../prompt-engineering/gh-pull-request/user.md',
        ),
      },
    })
    const run: TRun = {
      ...base,
      cfg: crustConfigSchema.parse({
        defaults: { protected_files: [] },
        observability: { db: join(base.sessionDir, 'no-database.db') },
        agents: [terminal],
        terminal: [terminal],
      }),
      repoRoot: base.sessionDir,
      vcsRoot: base.sessionDir,
      trust: 50,
      stream: false,
      agentMap: () => ({}),
      saveAgentMap: () => undefined,
      addUsage: () => undefined,
      console: {
        ...base.console,
        agentStarted: () => undefined,
        agentFinished: () => undefined,
        envelopeSummary: () => undefined,
      },
      tracer: {
        ...base.tracer,
        envelopeRow: () => undefined,
        agentSessionRow: () => undefined,
      },
    }
    const built = {
      ...CONTEXT_ENVELOPE_DEFAULTS,
      status: 'success' as const,
      summary: 'built the change',
      changed_files: ['src/work.ts'],
    }
    const verdicts = ['outcome-review', 'code-review'].map((name) => ({
      activity: name,
      envelope: {
        ...CONTEXT_ENVELOPE_DEFAULTS,
        status: 'success' as const,
        summary: `${name} verdict`,
        approved: true,
        blocking: [],
        findings: [
          {
            requirement: `${name} requirement`,
            met: true,
            evidence: `src/${name}.ts:42`,
          },
        ],
      },
    }))
    let prompt = ''
    const agentPorts: TAgentPorts = {
      run: (request) => {
        prompt = request.prompt
        return Promise.resolve({
          text: JSON.stringify({
            ...CONTEXT_ENVELOPE_DEFAULTS,
            status: 'success',
            summary: 'composed',
            title: 'Preserve envelope history',
            body: 'The complete reviews informed this description.',
          }),
          returncode: 0,
          sessionId: 'fixture-session',
          tokens: 0,
          cost: 0,
          usage: emptyUsage,
          contextTokens: 0,
          contextWindow: 0,
        })
      },
      changed: () => [],
      untracked: () => [],
      render,
      savePrompt: (directory, name) => join(directory, name),
      snapshot: () => ({}),
      rev: () => '',
    }
    const { ports } = fakePorts()
    const activity = ghPullRequestActivity(terminal, OPTIONS, ports, agentPorts)
    const handle: TActivityRunHandle = {
      activityRun: {
        activity_run_id: 'terminal-history',
        run_id: run.runId,
        seq: 1,
        params: activityRunParams({
          name: terminal.name,
          kind: 'agent',
          owner: terminal.name,
          description: 'Compose a pull request from every verdict',
        }),
        status: 'running',
        error: undefined,
        started_at: undefined,
        ended_at: undefined,
      },
      log: () => undefined,
    }

    try {
      // when
      const actual = await activity.deliver(
        aCtx(run, {
          previous: built,
          previousStep: 'build',
          upstream: [{ activity: 'build', envelope: built }, ...verdicts],
        }),
        handle,
      )

      // then
      expect(actual.fallback).toBe(false)
      expect(prompt).toContain(
        `## from build\n\n${JSON.stringify(built, undefined, 2)}`,
      )
      for (const verdict of verdicts) {
        expect(prompt).toContain(
          `## from ${verdict.activity}\n\n${JSON.stringify(verdict.envelope, undefined, 2)}`,
        )
      }
      expect(prompt).not.toContain('{{previous_envelopes}}')
    } finally {
      rmSync(run.sessionDir, { recursive: true, force: true })
      rmSync(run.contextHandoffDir, { recursive: true, force: true })
    }
  },
)
