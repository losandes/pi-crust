import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TActivityOptions,
  TActivityRunHandle,
  TGateReport,
  TRun,
  TTerminalConfig,
} from '../../../../lib/contracts'
import {
  activityRunParams,
  crustConfigSchema,
  DEFAULT_ACTIVITY_OPTIONS,
  PULL_REQUEST_EVENT,
  terminalConfigSchema,
} from '../../../../lib/contracts'
import { ensureDir, readText, writeText } from '../../../../lib/system'
import { runWithTracer } from '../../../../testing/fake-activity'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { emptyUsage, render, type TPiRequest } from '../../../agents'
import { createTracer } from '../../../trace'
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
    prompts: { system: 's.md', user: 'u.md' },
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
      routing: { checks: [], unmatched: 'warn' },
    },
    console: { note: () => undefined, gateResult: () => undefined },
    tracer: { event: () => undefined, gateRow: () => undefined },
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

for (const mode of [
  'empty',
  'missing-corrected',
  'missing-twice',
  'empty-file',
  'bad-json',
  'resume',
  'exists',
  'created-on-correction',
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a terminal report with ${mode} artifacts`,
      'when delivering through the real agent boundary',
      'it should record artifact judgments, correct once and deliver the latest verdict',
    ].join(', '),
    async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-terminal-artifacts-'))
      const terminal = config()
      const created = runWithTracer(
        dir,
        crustConfigSchema.parse({
          defaults: { data_dir: join(dir, 'data'), protected_files: [] },
          observability: { db: join(dir, 'crust.db') },
          agents: [terminal],
          terminal: [terminal],
        }),
      )
      let requests: readonly TPiRequest[] = []
      let rows: readonly Readonly<{ name: string; report: TGateReport }>[] = []
      let notes: readonly string[] = []
      let delivered = ''
      const run: TRun = {
        ...created,
        repoRoot: dir,
        vcsRoot: dir,
        sessionDir: join(dir, 'session'),
        contextHandoffDir: join(dir, 'handoff'),
        resume: new Set(mode === 'resume' ? ['gh-pull-request'] : []),
        console: {
          ...created.console,
          note: (note) => {
            notes = [...notes, note]
          },
          gateResult: () => undefined,
          agentStarted: () => undefined,
          agentFinished: () => undefined,
          envelopeSummary: () => undefined,
        },
        tracer: {
          ...created.tracer,
          gateRow: (activityRun, name, report) => {
            rows = [...rows, { name, report }]
            return created.tracer.gateRow(activityRun, name, report)
          },
        },
      }
      run.tracer.sessionStart(run.runId, 'tester', 'compose')
      const handle: TActivityRunHandle = {
        activityRun: {
          activity_run_id: 'terminal-artifact-run',
          run_id: run.runId,
          seq: 1,
          params: activityRunParams({
            name: terminal.name,
            owner: terminal.name,
            kind: 'agent',
            description: 'Compose the terminal pull request from accepted work',
          }),
          status: 'running',
          error: undefined,
          started_at: undefined,
          ended_at: undefined,
        },
        log: () => undefined,
      }
      run.tracer.activityRunUpsert(handle.activityRun)
      const artifact = join(
        dir,
        mode === 'bad-json' ? 'artifact.json' : 'artifact.md',
      )
      if (mode === 'empty-file') writeText(artifact, '')
      if (mode === 'bad-json') writeText(artifact, '{broken')
      if (mode === 'exists') writeText(artifact, 'evidence\n')
      const report = (artifacts: readonly string[]) => ({
        ...CONTEXT_ENVELOPE_DEFAULTS,
        status: 'success',
        title: 'Implement the change',
        body: 'The requested change.',
        artifacts,
      })
      if (mode === 'resume') resumedEnvelope(run, report([artifact]))
      const agentPorts: TAgentPorts = {
        run: (request) => {
          requests = [...requests, request]
          if (mode === 'created-on-correction' && requests.length === 2)
            writeText(artifact, 'corrected\n')
          const artifacts =
            mode === 'empty' ||
            mode === 'resume' ||
            (mode === 'missing-corrected' && requests.length === 2)
              ? []
              : [artifact]
          return Promise.resolve({
            text: JSON.stringify(report(artifacts)),
            returncode: 0,
            sessionId: request.sessionId,
            tokens: 0,
            cost: 0,
            usage: emptyUsage,
            contextTokens: 0,
            contextWindow: 0,
          })
        },
        changed: () => [],
        untracked: () => [],
        render: (path) => path,
        savePrompt: (directory, name) => join(directory, name),
        snapshot: () => ({}),
        rev: () => '',
        head: () => '',
        history: () => () => [],
        content: () => ({ status: 'ok', data: {} }),
      }
      const { ports } = fakePorts(
        {},
        {
          create: (params) => {
            delivered = readText(params.bodyPath)
            return 'https://example.com/owner/repo/pull/1'
          },
        },
      )
      try {
        // when
        const actual = await ghPullRequestActivity(
          terminal,
          OPTIONS,
          ports,
          agentPorts,
        ).deliver(aCtx(run), handle)
        // then
        const failsTwice = ['missing-twice', 'empty-file', 'bad-json'].includes(
          mode,
        )
        const corrected = [
          'missing-corrected',
          'missing-twice',
          'empty-file',
          'bad-json',
          'created-on-correction',
        ].includes(mode)
        expect(requests).toHaveLength(corrected ? 2 : 1)
        expect(rows.map((row) => row.name)).toEqual(
          Array.from({ length: corrected || mode === 'resume' ? 2 : 1 }, () => [
            'artifacts_exist',
            'files_non_empty',
            'json_parses',
          ]).flat(),
        )
        expect(actual.action).toBe('created')
        expect(actual.fallback).toBe(failsTwice)
        if (mode === 'empty')
          expect(rows.every((row) => row.report.checks.length === 0)).toBe(true)
        if (corrected || mode === 'resume') {
          expect(requests.at(-1)?.prompt).toContain(artifact)
          expect(requests.at(-1)?.prompt).toContain(
            mode === 'empty-file'
              ? 'empty'
              : mode === 'bad-json'
                ? 'JSON'
                : 'declared artifact does not exist',
          )
        }
        if (corrected)
          expect(requests[0]?.sessionId).toBe(requests[1]?.sessionId)
        if (mode === 'missing-corrected' || mode === 'missing-twice') {
          expect(rows[0]?.report.checks).toContainEqual(
            expect.objectContaining({ item: artifact, ok: false }),
          )
          expect(delivered).toContain(
            `- [ ] ${artifact} — declared artifact does not exist (artifacts_exist gate, `,
          )
        }
        if (mode === 'exists' || mode === 'created-on-correction') {
          expect(delivered).toContain(`- [x] ${artifact} — exists`)
          expect(delivered).toContain('(artifacts_exist gate, ')
          expect(delivered).not.toContain(
            `- [ ] ${artifact} — declared artifact does not exist (artifacts_exist gate, `,
          )
        }
        if (failsTwice) expect(notes.join('\n')).toContain(artifact)
        if (mode === 'empty-file')
          expect(
            rows.find((row) => row.name === 'files_non_empty')?.report.checks[0]
              ?.ok,
          ).toBe(false)
        if (mode === 'bad-json')
          expect(
            rows.find((row) => row.name === 'json_parses')?.report.checks[0]
              ?.ok,
          ).toBe(false)
      } finally {
        run.tracer.close()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

const OPTIONS: TActivityOptions = DEFAULT_ACTIVITY_OPTIONS

for (const action of ['created', 'updated', 'refused'] as const) {
  test(
    [
      `given a pull request delivery that is ${action}`,
      'when the terminal Activity delivers',
      'it should persist exactly one delivered URL or none for a refusal',
    ].join(', '),
    async () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-pr-event-'))
      const tracer = createTracer(
        join(dir, 'crust.db'),
        join(dir, 'events.jsonl'),
      )
      const run = aRun({ resume: new Set(['gh-pull-request']), tracer })
      tracer.sessionStart(run.runId, 'tester', 'compose')
      const url = 'https://example.com/owner/repo/pull/1'
      const { ports } = fakePorts(
        {},
        {
          authenticated: () => action !== 'refused',
          find: () => (action === 'updated' ? url : ''),
        },
      )
      resumedEnvelope(run, {
        status: 'success',
        summary: 'done',
        title: 'Ship it',
        body: 'Complete work.',
      })
      try {
        // when
        const result = await ghPullRequestActivity(
          config(),
          OPTIONS,
          ports,
        ).deliver(aCtx(run), aHandle())
        // then
        expect(result.action).toBe(action)
        const recorded = tracer.eventsNamed(run.runId, PULL_REQUEST_EVENT)
        expect(recorded).toHaveLength(action === 'refused' ? 0 : 1)
        if (action !== 'refused')
          expect(recorded[0]).toMatchObject({ url, action })
      } finally {
        tracer.close()
        rmSync(dir, { recursive: true, force: true })
        rmSync(run.sessionDir, { recursive: true, force: true })
        rmSync(run.contextHandoffDir, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given the gh-pull-request terminal Activity',
    'when it declares its engine requirements',
    'it should require committing regardless of the invocation',
  ].join(', '),
  () => {
    // given
    const { ports } = fakePorts()

    // when
    const actual = ghPullRequestActivity(config(), OPTIONS, ports)

    // then
    expect(actual.requiresCommitting).toBe(true)
  },
)

test(
  [
    'given a push port that throws a multi-line SSH failure',
    'when gh-pull-request tries to deliver',
    'it should return a recoverable refusal before finding, creating or updating any pull request',
  ].join(', '),
  async () => {
    // given
    const { ports, calls } = fakePorts({
      push: () => {
        throw new Error('SSH agent unavailable\nmore details')
      },
    })
    const activity = ghPullRequestActivity(config(), OPTIONS, ports)
    const run = aRun({ resume: new Set(['gh-pull-request']) })
    resumedEnvelope(run, {
      status: 'success',
      summary: 'done',
      title: 'Ship it',
      body: 'Complete work.',
    })
    try {
      // when
      const actual = await activity.deliver(aCtx(run), aHandle())

      // then
      expect(actual).toEqual({
        action: 'refused',
        url: '',
        reason: 'git push failed: SSH agent unavailable',
        recoverable: true,
        fallback: false,
      })
      expect(calls).toEqual([])
    } finally {
      rmSync(run.sessionDir, { recursive: true, force: true })
      rmSync(run.contextHandoffDir, { recursive: true, force: true })
    }
  },
)

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
    expect(actual.recoverable).toBe(false)
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
    expect(actual.recoverable).toBe(false)
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
    expect(actual.reason).toMatch(/IS the base branch 'main'/)
    expect(actual.recoverable).toBe(false)
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
    expect(actual.recoverable).toBe(false)
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
    expect(actual.recoverable).toBe(false)
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
    expect(actual.recoverable).toBe(false)
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
    expect(actual.recoverable).toBe(true)
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
    expect(actual.recoverable).toBe(false)
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
    expect(actual.recoverable).toBe(false)
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
      prompts: {
        system: join(
          import.meta.dir,
          '../../../../prompts/gh-pull-request/system.md',
        ),
        user: join(
          import.meta.dir,
          '../../../../prompts/gh-pull-request/user.md',
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
      head: () => '',
      history: () => () => [],
      content: () => ({ status: 'ok', data: {} }),
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
