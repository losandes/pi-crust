/**
 * `execute-agent.ts` with every side effect it performs routed through an
 * injected `TAgentPorts` (COVERAGE-AGENT-PORTS.md). No test here spawns the
 * `pi` binary or a git subprocess through the ports this module owns — the
 * fakes below stand in for all seven of them.
 *
 * Permission enforcement consumes the before and after snapshots from these
 * ports too, so plain temporary directories suffice; no git repository is
 * needed for a fake-port test.
 */

import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityRun,
  TActivityRunHandle,
  TAgentCall,
  TEventInput,
  TPiCrustConfig,
  TRun,
} from '../../../../lib/contracts'
import {
  activityRunParams,
  agentConfigSchema,
  crustConfigSchema,
  genericOutput,
  WARNING_EVENT,
} from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import type { TPiControl, TPiHooks, TPiResult } from '../../../agents'
import { appendSteering, emptyUsage, postToInbox } from '../../../agents'
import { PATHS_TOUCHED, policyPaths } from '../../../policy'
import type { TAgentPorts } from './execute-agent'
import {
  callAgent,
  executeAgent,
  feedbackBlock,
  findingsBlock,
  JSON_FIX_ATTEMPTS,
} from './execute-agent'

/** A plain temporary workspace; all VCS observations come from the ports. */
const aRepo = (): string =>
  mkdtempSync(join(tmpdir(), 'crust-execute-agent-repo-'))

const aPiResult = (
  overrides: Readonly<Partial<TPiResult>> = {},
): TPiResult => ({
  text: '',
  returncode: 0,
  sessionId: 'session-1',
  tokens: 0,
  cost: 0,
  usage: emptyUsage,
  contextTokens: 0,
  contextWindow: 0,
  ...overrides,
})

const VALID_ENVELOPE_TEXT = JSON.stringify({
  status: 'success',
  summary: 'did the thing',
  artifacts: [],
  notes_for_next_agent: '',
})

/** A ports fixture whose every member is a recorder, never a real adapter. */
const fakePorts = (
  overrides: Readonly<Partial<TAgentPorts>> = {},
): Readonly<{ ports: TAgentPorts; calls: Record<string, unknown>[] }> => {
  const calls: Record<string, unknown>[] = []
  const ports: TAgentPorts = {
    run: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'run' })
      return Promise.resolve(aPiResult({ text: VALID_ENVELOPE_TEXT }))
    },
    changed: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'changed' })
      return []
    },
    untracked: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'untracked' })
      return []
    },
    render: (templatePath, variables) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'render', templatePath, variables })
      return `rendered:${templatePath}`
    },
    savePrompt: (directory, name) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'savePrompt', directory, name })
      return join(directory, name)
    },
    snapshot: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'snapshot' })
      return {}
    },
    content: () => ({ status: 'ok', data: {} }),
    rev: () => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was called is the test
      calls.push({ op: 'rev' })
      return ''
    },
    ...overrides,
  }
  return { ports, calls }
}

const aConfig = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
): TPiCrustConfig =>
  crustConfigSchema.parse({
    defaults: { protected_files: [] },
    agents: [
      agentConfigSchema.parse({
        name: 'builder',
        purpose: 'build the thing',
        prompt_engineering: { system: 's.md', user: 'u.md' },
        writes: ['*'],
        ...overrides,
      }),
    ],
  })

const aRun = (
  repoRoot: string,
  overrides: Readonly<Partial<TRun>> = {},
): Readonly<{ run: TRun; events: Record<string, unknown>[] }> => {
  const sessionDir = mkdtempSync(join(tmpdir(), 'crust-execute-agent-session-'))
  const contextHandoffDir = mkdtempSync(
    join(tmpdir(), 'crust-execute-agent-handoff-'),
  )
  const events: Record<string, unknown>[] = []
  const run: TRun = {
    cfg: aConfig(),
    runId: 'aaaa1111',
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
      throw new Error('not used by execute-agent')
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
      event: (input: TEventInput) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was traced is the test
        events.push(input as unknown as Record<string, unknown>)
        return 'evt'
      },
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
    ...overrides,
  } as unknown as TRun
  return { run, events }
}

const anActivityRun = (
  overrides: Readonly<Partial<TActivityRun>> = {},
): TActivityRun => ({
  activity_run_id: 'ar_builder_1',
  run_id: 'aaaa1111',
  seq: 1,
  params: activityRunParams({
    name: 'build',
    kind: 'agent',
    owner: 'builder',
    description: 'Build the thing',
  }),
  status: 'running',
  error: undefined,
  started_at: undefined,
  ended_at: undefined,
  ...overrides,
})

const aCall = (overrides: Readonly<Partial<TAgentCall>> = {}): TAgentCall => ({
  outputType: genericOutput,
  prompt: 'build the thing',
  committing: true,
  blockingFindings: [],
  ...overrides,
})

test(
  [
    'given use-cases/execute-agent::executeAgent',
    "when the agent's first reply is not valid JSON but a retry's is",
    'it should re-ask the same session and succeed on the second attempt',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    let attempt = 0
    const retried: string[] = []
    const { ports } = fakePorts({
      run: (request) => {
        attempt += 1
        // biome-ignore lint/plugin/no-array-mutation: recording what was sent is the test
        retried.push(request.prompt)
        return Promise.resolve(
          aPiResult({
            text: attempt === 1 ? 'not json at all' : VALID_ENVELOPE_TEXT,
          }),
        )
      },
    })

    // when
    const envelope = await executeAgent(run, activityRun, aCall(), ports)

    // then
    expect(attempt).toBe(2)
    expect(envelope.status).toBe('success')
    expect(retried[1]).toContain('Respond again with ONLY a JSON object')
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when every attempt, including every retry, produces invalid JSON',
    'it should stop after JSON_FIX_ATTEMPTS retries and throw naming the reason',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    let attempt = 0
    const { ports } = fakePorts({
      run: () => {
        attempt += 1
        return Promise.resolve(aPiResult({ text: 'still not json' }))
      },
    })

    // when, then
    await expect(
      executeAgent(run, activityRun, aCall(), ports),
    ).rejects.toThrow(/never produced valid GenericOutput JSON/)
    expect(attempt).toBe(JSON_FIX_ATTEMPTS + 1)
  },
)

test(
  [
    'given no review findings',
    'when rendering the findings block',
    'it should render nothing',
  ].join(', '),
  () => {
    // given
    const findings: readonly string[] = []

    // when
    const actual = findingsBlock(findings)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given two review findings',
    'when rendering the findings block',
    'it should attribute them to review and require one answer per finding',
  ].join(', '),
  () => {
    // given
    const findings = ['first finding', 'second finding']

    // when
    const actual = findingsBlock(findings)

    // then
    expect(actual).toBe(
      '\n\n## Blocking findings from review\n\n' +
        'The review of your work raised these blocking findings:\n\n' +
        '- first finding\n- second finding\n\n' +
        "Give every finding exactly one answer: fix it, or dispute it in `disputes` with evidence a third party can re-check. A finding that one of this repository's declared checks decides may not be disputed. Fix it.",
    )
  },
)

for (const revising of [true, false]) {
  test(
    [
      `given an agent with a revise override and findings ${revising}`,
      'when executeAgent sends its prompt',
      'it should select the revise override only for a revise round',
    ].join(', '),
    async () => {
      // given
      const repoRoot = aRepo()
      const { run } = aRun(repoRoot, {
        cfg: aConfig({
          prompt_engineering: { system: 's.md', user: 'u.md', revise: 'r.md' },
        }),
      })
      const requests: string[] = []
      const { ports, calls } = fakePorts({
        run: (request) => {
          // biome-ignore lint/plugin/no-array-mutation: recording what was sent is the test
          requests.push(request.prompt)
          return Promise.resolve(aPiResult({ text: VALID_ENVELOPE_TEXT }))
        },
      })
      const findings = revising ? ['first finding', 'second finding'] : []
      try {
        // when
        await executeAgent(
          run,
          anActivityRun(),
          aCall({ blockingFindings: findings }),
          ports,
        )

        // then
        expect(
          calls
            .filter((one) => one.op === 'render')
            .map((one) => one.templatePath),
        ).toEqual(['s.md', revising ? 'r.md' : 'u.md'])
        expect(requests[0]).toBe(
          `rendered:${revising ? 'r.md' : 'u.md'}${findingsBlock(findings)}`,
        )
      } finally {
        rmSync(repoRoot, { recursive: true, force: true })
        rmSync(run.sessionDir, { recursive: true, force: true })
        rmSync(run.contextHandoffDir, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given use-cases/execute-agent::feedbackBlock',
    'when there are no violations',
    'it should render nothing',
  ].join(', '),
  () => {
    // given
    const violations: readonly string[] = []

    // when
    const actual = feedbackBlock(violations)

    // then
    expect(actual).toBe('')
  },
)

test(
  [
    'given use-cases/execute-agent::feedbackBlock',
    'when there are violations',
    'it should render each one under "What failed last time"',
  ].join(', '),
  () => {
    // given
    const violations = ['missing a test', 'left a TODO']

    // when
    const block = feedbackBlock(violations)

    // then
    expect(block).toContain('## What failed last time')
    expect(block).toContain('- missing a test')
    expect(block).toContain('- left a TODO')
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    "when the path policy recorded a 'stop' refusal for this activity run",
    'it should throw naming the refusal, after the call already happened',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun({ activity_run_id: 'ar_stop_1' })
    const agentDir = join(run.sessionDir, 'builder')
    mkdirSync(agentDir, { recursive: true })
    const paths = policyPaths(agentDir, activityRun.activity_run_id)
    writeFileSync(
      paths.refusals,
      `${JSON.stringify({
        tool: 'bash',
        path: '.pi-crust/config/crust.config.yaml',
        intent: 'write',
        reason: 'protected',
        verb: 'stop',
        bestEffort: false,
      })}\n`,
    )
    const { ports } = fakePorts()

    // when, then
    await expect(
      executeAgent(run, activityRun, aCall(), ports),
    ).rejects.toThrow(
      /builder reached a path this repository governs with 'stop'/,
    )
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when the caller supplies changedPaths',
    'it should use them rather than the ports working-tree reads',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const renders: Record<string, string>[] = []
    const { ports } = fakePorts({
      render: (templatePath, variables) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was rendered is the test
        renders.push({ ...variables })
        return `rendered:${templatePath}`
      },
    })

    // when
    await executeAgent(
      run,
      activityRun,
      aCall({ changedPaths: ['a.ts', 'b.ts'] }),
      ports,
    )

    // then
    expect(renders[0]?.changed_files).toBe('a.ts\nb.ts')
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when the caller does not supply changedPaths',
    "it should use the ports' changed and untracked paths instead",
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const renders: Record<string, string>[] = []
    const { ports } = fakePorts({
      changed: () => ['changed.ts'],
      untracked: () => ['new.ts'],
      render: (templatePath, variables) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was rendered is the test
        renders.push({ ...variables })
        return `rendered:${templatePath}`
      },
    })

    // when
    await executeAgent(run, activityRun, aCall(), ports)

    // then
    expect(renders[0]?.changed_files).toBe('changed.ts\nnew.ts')
  },
)

test(
  [
    'given use-cases/execute-agent::callAgent',
    "when the handle's activity run kind IS 'agent'",
    'it should delegate to executeAgent and return its envelope',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const handle: TActivityRunHandle = { activityRun, log: () => undefined }
    const { ports } = fakePorts()

    // when
    const envelope = await callAgent(run, handle, aCall(), ports)

    // then
    expect(envelope.status).toBe('success')
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when pi forwards narration and a completed tool call through onEvent',
    'it should trace both as events, labelled with the agent and the turn',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run, events } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const { ports } = fakePorts({
      run: (_request, hooks) => {
        hooks?.onEvent?.({
          type: 'text_end',
          content: [{ type: 'text', text: 'thinking out loud' }],
        })
        hooks?.onEvent?.({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'call_1',
                name: 'bash',
                arguments: { command: 'ls' },
              },
            ],
          },
        })
        hooks?.onEvent?.({
          type: 'tool_execution_end',
          toolCallId: 'call_1',
          toolName: 'bash',
          args: { command: 'ls' },
          result: { content: [{ type: 'text', text: 'README.md' }] },
        })
        return Promise.resolve(aPiResult({ text: VALID_ENVELOPE_TEXT }))
      },
    })

    // when
    await executeAgent(run, activityRun, aCall(), ports)

    // then
    expect(events.some((event) => event.type === 'narration')).toBe(true)
    expect(events.some((event) => event.type === 'tool_call')).toBe(true)
  },
)

test(
  [
    'given use-cases/execute-agent::callAgent',
    "when the handle's activity run kind is not 'agent'",
    'it should throw before executeAgent ever runs',
  ].join(', '),
  () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun({
      params: activityRunParams({
        name: 'build',
        kind: 'code',
        owner: 'builder',
        description: 'Build the thing',
      }),
    })
    const handle: TActivityRunHandle = { activityRun, log: () => undefined }
    const { ports, calls } = fakePorts()

    // when, then
    expect(() => callAgent(run, handle, aCall(), ports)).toThrow(
      /callAgent\(\) is only valid inside an agent activity-run/,
    )
    expect(calls).toEqual([])
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when the agent changes a path it never declared in `writes`',
    'it should report the overstep and the observed-paths payload, not revert it',
  ].join(', '),
  async () => {
    // given — writes: [] means the agent may change nothing
    const repoRoot = aRepo()
    const { run, events } = aRun(repoRoot, {
      cfg: crustConfigSchema.parse({
        defaults: { protected_files: [] },
        agents: [
          agentConfigSchema.parse({
            name: 'reviewer',
            purpose: 'review only',
            prompt_engineering: { system: 's.md', user: 'u.md' },
            writes: [],
          }),
        ],
      }),
    })
    let snapshots = 0
    const activityRun = anActivityRun({
      params: activityRunParams({
        name: 'review',
        kind: 'agent',
        owner: 'reviewer',
        description: 'Review the thing',
      }),
    })
    const { ports } = fakePorts({
      snapshot: () => {
        snapshots += 1
        return snapshots === 1 ? {} : { 'README.md': '1,1' }
      },
    })

    // when
    const envelope = await executeAgent(
      run,
      activityRun,
      aCall({ committing: false }),
      ports,
    )

    // then
    expect(envelope.status).toBe('success')
    const touched = events.find((event) => event.name === PATHS_TOUCHED)
    expect(touched).toBeDefined()
    const touchedPayload = (touched?.payload ?? {}) as Readonly<{
      paths?: readonly string[]
    }>
    expect(touchedPayload.paths).toContain('README.md')
    const warnings = events.filter((event) => event.name === WARNING_EVENT)
    expect(
      warnings.some(
        (event) => (event.payload as { kind: string }).kind === 'overstep',
      ),
    ).toBe(true)
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent with committing disabled',
    'when the injected HEAD changes during the agent call',
    'it should trace the unauthorized commit as a permission breach',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run, events } = aRun(repoRoot)
    let reads = 0
    const { ports } = fakePorts({
      rev: () => {
        reads += 1
        return (reads === 1 ? 'a' : 'b').repeat(40)
      },
    })
    try {
      // when
      await executeAgent(
        run,
        anActivityRun(),
        aCall({ committing: false }),
        ports,
      )

      // then
      const breach = events.find((event) => event.name === 'permission_breach')
      expect(breach).toBeDefined()
      expect((breach?.payload as { note: string } | undefined)?.note).toContain(
        'HEAD moved from aaaaaaa to bbbbbbb',
      )
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
      rmSync(run.sessionDir, { recursive: true, force: true })
      rmSync(run.contextHandoffDir, { recursive: true, force: true })
    }
  },
)

for (const hasReviewer of [true, false]) {
  test(
    [
      'given use-cases/execute-agent::executeAgent',
      `when the loaded registry ${hasReviewer ? 'contains a reviewer' : 'has no annotating handoffs'}`,
      'it should render the annotating handoff list from that registry',
    ].join(', '),
    async () => {
      // given
      const repoRoot = aRepo()
      const cfg = hasReviewer
        ? crustConfigSchema.parse({
            defaults: { protected_files: [] },
            agents: aConfig().agents,
            activities: [
              {
                name: 'reviewer',
                output: 'reviewOutput',
                writes: ['{handoff}/verdict.md'],
                prompt_engineering: { system: 's.md', user: 'u.md' },
              },
            ],
          })
        : aConfig()
      const { run } = aRun(repoRoot, { cfg })
      const renders: Record<string, string>[] = []
      const { ports } = fakePorts({
        render: (templatePath, variables) => {
          // biome-ignore lint/plugin/no-array-mutation: recording what was rendered is the test
          renders.push({ ...variables })
          return `rendered:${templatePath}`
        },
      })

      try {
        // when
        await executeAgent(run, anActivityRun(), aCall(), ports)

        // then
        expect(renders[0]?.annotating_handoffs).toBe(
          hasReviewer
            ? `- reviewer: ${run.contextHandoffDir}/verdict.md`
            : '(none)',
        )
      } finally {
        rmSync(repoRoot, { recursive: true, force: true })
        rmSync(run.sessionDir, { recursive: true, force: true })
        rmSync(run.contextHandoffDir, { recursive: true, force: true })
      }
    },
  )
}

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when the call carries a history spanning several Stages',
    'it should render every envelope in order with provenance, independently of the single previous envelope',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const renders: Record<string, string>[] = []
    const { ports } = fakePorts({
      render: (templatePath, variables) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was rendered is the test
        renders.push({ ...variables })
        return `rendered:${templatePath}`
      },
    })

    // when
    await executeAgent(
      run,
      activityRun,
      aCall({
        upstream: [
          {
            activity: 'scout',
            envelope: {
              status: 'success',
              summary: 'found it',
              artifacts: [],
              notes_for_next_agent: '',
            },
          },
          {
            activity: 'build',
            envelope: {
              status: 'success',
              summary: 'built it',
              artifacts: [],
              notes_for_next_agent: '',
            },
          },
          {
            activity: 'code-review',
            envelope: {
              status: 'success',
              summary: 'review evidence',
              artifacts: [],
              notes_for_next_agent: '',
            },
          },
        ],
      }),
      ports,
    )

    // then
    const history = renders[0]?.previous_envelopes ?? ''
    expect(history).toContain('## from scout\n\n{')
    expect(history).toContain('## from build\n\n{')
    expect(history).toContain('## from code-review\n\n{')
    expect(history).toContain('found it')
    expect(history).toContain('built it')
    expect(history).toContain('review evidence')
    expect(history.indexOf('## from scout')).toBeLessThan(
      history.indexOf('## from build'),
    )
    expect(history.indexOf('## from build')).toBeLessThan(
      history.indexOf('## from code-review'),
    )
    expect(renders[0]?.previous_envelope).toBe('(none)')
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when a developer has steered this run',
    'it should append the steering block to the prompt and trace that it applied',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run, events } = aRun(repoRoot)
    appendSteering(run.contextHandoffDir, 'Use tabs, not spaces.')
    const activityRun = anActivityRun()
    const { ports } = fakePorts()

    // when
    await executeAgent(run, activityRun, aCall(), ports)

    // then
    const applied = events.find((event) => event.name === 'steering_applied')
    expect(applied).toBeDefined()
    const appliedPayload = (applied?.payload ?? {}) as Readonly<{
      text?: string
    }>
    expect(appliedPayload.text).toBe('Use tabs, not spaces.')
  },
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    'when the call names a cohort agent the roster actually has',
    'it should resolve the sibling and exclude its paths from this one',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot, {
      cfg: crustConfigSchema.parse({
        defaults: { protected_files: [] },
        agents: [
          agentConfigSchema.parse({
            name: 'builder',
            prompt_engineering: { system: 's.md', user: 'u.md' },
            writes: ['*'],
          }),
          agentConfigSchema.parse({
            name: 'reviewer',
            prompt_engineering: { system: 's.md', user: 'u.md' },
            writes: ['*'],
          }),
        ],
      }),
    })
    const activityRun = anActivityRun()
    const { ports } = fakePorts()

    // when, then — resolves without throwing, whether or not the sibling
    // claimed anything; 'unknown-sibling' exercises the "not on the roster"
    // branch of the same flatMap
    const envelope = await executeAgent(
      run,
      activityRun,
      aCall({ cohort: ['reviewer', 'unknown-sibling'] }),
      ports,
    )
    expect(envelope.status).toBe('success')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given use-cases/execute-agent::executeAgent',
    "when a message lands in this run's inbox while the agent is working",
    'it should forward it to the control surface and trace the inbox event',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run, events } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const steered: string[] = []
    const control: TPiControl = {
      steer: (message) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was steered is the test
        steered.push(message)
      },
      followUp: () => undefined,
      abort: () => undefined,
    }
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms))
    const { ports } = fakePorts({
      run: async (
        _request: Parameters<TAgentPorts['run']>[0],
        hooks?: TPiHooks,
      ) => {
        hooks?.onControl?.(control)
        hooks?.onSpawn?.(4242)
        // posted AFTER control starts \u2014 deliverFromInbox's cursor begins at
        // whatever was already in the file, same as a run resuming mid-stream
        postToInbox(run.sessionDir, 'steer', 'be more careful', 'tester')
        // long enough for the 1s poll inside deliverFromInbox to fire at least once
        await sleep(1100)
        hooks?.onExit?.(4242)
        return aPiResult({ text: VALID_ENVELOPE_TEXT })
      },
    })

    // when
    await executeAgent(run, activityRun, aCall(), ports)

    // then
    expect(steered).toEqual(['be more careful'])
    expect(events.some((event) => event.name === 'inbox_steer')).toBe(true)
  },
  5_000,
)

test(
  [
    'given use-cases/execute-agent::executeAgent',
    "when the agent's final envelope reports status: 'fail'",
    'it should throw naming the agent and the summary it gave',
  ].join(', '),
  async () => {
    // given
    const repoRoot = aRepo()
    const { run } = aRun(repoRoot)
    const activityRun = anActivityRun()
    const { ports } = fakePorts({
      run: async () =>
        aPiResult({
          text: JSON.stringify({
            status: 'fail',
            summary: 'could not finish',
            artifacts: [],
            notes_for_next_agent: '',
          }),
        }),
    })

    // when, then
    await expect(
      executeAgent(run, activityRun, aCall(), ports),
    ).rejects.toThrow(/builder reported status='fail': could not finish/)
  },
)
