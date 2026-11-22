import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  TActivity,
  TActivityContext,
  TActivityRun,
  TEnvelopeBase,
  TRun,
  TTracer,
} from '../../../../lib/contracts'
import {
  buildOutputSchema,
  crustConfigSchema,
  envelopeNamed,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { fakeActivity } from '../../../../testing/fake-activity'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { runnableActivities } from '../../../activities'
import type { TPiRequest } from '../../../agents'
import { emptyUsage, render } from '../../../agents'
import { createConsole } from './report-to-console'
import { reviseActivity, runReviseLoop } from './revise-loop'
import { runActivities, runUnits } from './run-activities'

const CONTEXT = {
  status: 'success' as const,
  summary: '',
  artifacts: [],
  notes_for_next_agent: '',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

const work = (summary: string) =>
  buildOutputSchema.parse({
    ...CONTEXT,
    summary,
    changed_files: ['src/claimed.ts'],
  })

const review = (name: string, round: number, approved = false) =>
  reviewOutputSchema.parse({
    ...CONTEXT,
    summary: `${name} round ${round}`,
    approved,
    blocking: approved ? [] : [`${name} requirement`],
    findings: [
      {
        requirement: `${name} requirement`,
        met: approved,
        evidence: `src/${name}.ts:${round * 10}`,
      },
    ],
  })

const shippedPrompts = (name: string) => ({
  system: join(import.meta.dir, '../../../../prompts', name, 'system.md'),
  user: join(import.meta.dir, '../../../../prompts', name, 'user.md'),
})

const fixtureWith = (activities: readonly Record<string, unknown>[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-history-boundary-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/claimed.ts'), 'export const built = true\n')
  const entries = activities.map((entry) => ({
    model: `fixture/${String(entry.name)}`,
    purpose: `Carry out ${String(entry.name)}`,
    prompts: {
      system: `${String(entry.name)}/system`,
      user: `${String(entry.name)}/user`,
    },
    writes: [],
    ...entry,
  }))
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: join(dir, 'data'), protected_files: [] },
    observability: { db: join(dir, 'unused.db') },
    activities: entries,
    agents: entries,
  })
  const tracer: TTracer = {
    dbPath: cfg.observability.db,
    event: () => 'fixture-event',
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
    gateRow: () => undefined,
    agentSessionRow: () => undefined,
    close: () => undefined,
  }
  // Keep state local: createRun would honor the operator's CRUST_DATA_DIR.
  let rows: readonly TActivityRun[] = []
  let seq = 0
  const run: TRun = {
    cfg,
    runId: 'history1',
    tracer,
    console: createConsole(tracer, 'history1'),
    engineer: 'tester',
    stream: false,
    trust: 50,
    repoRoot: dir,
    vcsRoot: dir,
    sessionDir: join(dir, 'session'),
    contextHandoffDir: join(dir, 'handoff'),
    resume: new Set<string>(),
    claimResume: () => false,
    activityRuns: () => rows,
    recordActivityRun: (row) => {
      rows = [...rows, row]
    },
    updateActivityRun: (id, patch) => {
      const row = rows.find((one) => one.activity_run_id === id)
      if (row === undefined)
        throw new Error(`missing fixture Activity Run: ${id}`)
      const updated = { ...row, ...patch }
      rows = rows.map((one) => (one.activity_run_id === id ? updated : one))
      return updated
    },
    nextSeq: () => {
      seq += 1
      return seq
    },
    tokens: () => 0,
    cost: () => 0,
    addUsage: () => undefined,
    agentMap: () => ({}),
    saveAgentMap: () => undefined,
  }
  mkdirSync(run.sessionDir, { recursive: true })
  mkdirSync(run.contextHandoffDir, { recursive: true })
  silenceTerminal()

  return {
    run,
    [Symbol.dispose]: () => {
      rmSync(dir, { recursive: true, force: true })
      restoreTerminal()
    },
  }
}

const contextFor = (run: TRun): TActivityContext => ({
  run,
  prompt: 'implement the request',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})

const portsFor = (
  answer: (model: string, attempt: number) => TEnvelopeBase,
) => {
  let counts: Readonly<Record<string, number>> = {}
  let requests: readonly TPiRequest[] = []
  let renders: readonly Readonly<{
    path: string
    variables: Readonly<Record<string, string>>
  }>[] = []
  const ports: TAgentPorts = {
    run: (request) => {
      const count = (counts[request.model] ?? 0) + 1
      counts = { ...counts, [request.model]: count }
      requests = [...requests, request]
      return Promise.resolve({
        text: JSON.stringify(answer(request.model, count)),
        returncode: 0,
        sessionId: 'fixture-session',
        tokens: 0,
        cost: 0,
        usage: emptyUsage,
        contextTokens: 0,
        contextWindow: 0,
      })
    },
    changed: () => ['unrelated.ts'],
    untracked: () => [],
    render: (path, variables) => {
      renders = [...renders, { path, variables }]
      return path.endsWith('.md') ? render(path, variables) : path
    },
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
  }

  return { ports, requests: () => requests, renders: () => renders }
}

const successionCases = [
  {
    name: 'gh-issue',
    output: 'ghIssueOutput',
    succession: 'annotates',
    expected: 'build',
  },
  {
    name: 'code-review',
    output: 'genericOutput',
    expected: 'code-review',
  },
  {
    name: 'custom-check',
    output: 'reviewOutput',
    succession: 'supersedes',
    expected: 'custom-check',
  },
  {
    name: 'custom-note',
    output: 'buildOutput',
    succession: 'annotates',
    expected: 'build',
  },
]

for (const given of successionCases) {
  test(
    [
      `given issue #108 requirements 1.1.2 and 1.2.1 with ${given.name}`,
      'when a consumer follows its registry-configured output',
      'it should select previous and its provenance from succession, not the Activity name or payload shape',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith([given])
      const { run } = fixture
      const built = work('the work')
      const middle = work('an envelope with changed_files')
      let received: TActivityContext | undefined
      const consumer = fakeActivity('consumer', [])

      // when
      await runActivities({
        run,
        start: contextFor(run),
        activities: [
          fakeActivity('build', [{ kind: 'accepted', envelope: built }]),
          fakeActivity(given.name, [{ kind: 'accepted', envelope: middle }]),
          {
            ...consumer,
            execute: (ctx, handle) => {
              received = ctx
              return consumer.execute(ctx, handle)
            },
          },
        ],
      })

      // then
      expect(received?.previous).toBe(
        given.expected === 'build' ? built : middle,
      )
      expect(received?.previousStep).toBe(given.expected)
      expect(received?.upstream).toEqual([
        { activity: 'build', envelope: built },
        { activity: given.name, envelope: middle },
      ])
    },
  )
}

test(
  [
    'given issue #108 requirement 1.3.1 and two writers separated by an annotator',
    'when the first writer and annotator run again under numbered instances',
    'it should replace their history entries in place while selecting the most recently produced work',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      { name: 'alpha', output: 'buildOutput' },
      { name: 'note', output: 'reviewOutput' },
      { name: 'beta', output: 'buildOutput' },
    ])
    const { run } = fixture
    const { ports } = portsFor((model, attempt) =>
      model === 'fixture/note'
        ? review('note', attempt, true)
        : work(`${model} v${attempt}`),
    )

    // when
    const actual = await runActivities({
      run,
      start: contextFor(run),
      activities: runnableActivities(
        ['alpha', 'note', 'beta', 'alpha', 'note'],
        run.cfg,
        {},
        ports,
      ),
    })

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'alpha',
      'note',
      'beta',
    ])
    expect(actual.upstream.map((one) => one.envelope.summary)).toEqual([
      'fixture/alpha v2',
      'note round 2',
      'fixture/beta v1',
    ])
    expect(actual.previous?.summary).toBe('fixture/alpha v2')
    expect(actual.previousStep).toBe('alpha')
  },
)

test(
  [
    'given issue #108 requirements 1.3.2 and 1.4.3 and a serial discovery chain',
    'when plan receives its shipped user prompt through the agent boundary',
    'it should be able to read identify facts, assumptions and unresolved questions as well as conceptualize',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      { name: 'identify', output: 'planOutput' },
      { name: 'conceptualize', output: 'planOutput' },
      {
        name: 'plan',
        output: 'planOutput',
        prompts: shippedPrompts('plan'),
      },
    ])
    const { run } = fixture
    const planSpec = envelopeNamed('planOutput')
    if (planSpec === undefined) throw new Error('missing plan contract')
    const identified = planSpec.schema.parse({
      ...CONTEXT,
      summary: 'identified requirements',
      facts: [
        {
          fact: 'must preserve caller-visible provenance',
          evidence: 'request.md:12',
        },
      ],
      assumptions: [
        {
          assumption: 'the caller uses a custom registry',
          invalidated_by: 'a fixed built-in registry',
        },
      ],
      unresolved: [
        {
          question: 'which registry owns this Activity?',
          consequential: false,
          beyond_this_run: false,
          provisional_answer: 'the registry loaded for this run',
        },
      ],
    })
    const conceptualized = planSpec.schema.parse({
      ...CONTEXT,
      summary: 'conceptual design',
    })
    const { ports, requests } = portsFor((model) =>
      model === 'fixture/identify' ? identified : conceptualized,
    )

    // when
    await runActivities({
      run,
      start: contextFor(run),
      activities: runnableActivities(
        ['identify', 'conceptualize', 'plan'],
        run.cfg,
        {},
        ports,
      ),
    })

    // then
    const prompt =
      requests().find((one) => one.model === 'fixture/plan')?.prompt ?? ''
    const first = `## from identify\n\n${JSON.stringify(identified, undefined, 2)}`
    const second = `## from conceptualize\n\n${JSON.stringify(conceptualized, undefined, 2)}`
    expect(prompt).toContain(first)
    expect(prompt).toContain(second)
    expect(prompt.indexOf(first)).toBeLessThan(prompt.indexOf(second))
    expect(prompt).not.toContain('{{previous_envelopes}}')
  },
)

test(
  [
    'given issue #108 requirements 1.2.3 and 1.2.4 and a concurrent Stage after built work',
    'when an empty result and an annotation precede two writers that finish in reverse order',
    'it should give every sibling the original work and select the first declared superseding result',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      { name: 'annotation', output: 'reviewOutput' },
    ])
    const { run } = fixture
    const original = work('original')
    const seed = await runActivities({
      run,
      start: contextFor(run),
      activities: [
        fakeActivity('build', [{ kind: 'accepted', envelope: original }]),
      ],
    })
    let received: readonly TActivityContext[] = []
    const { promise: secondFinished, resolve: release } =
      Promise.withResolvers<void>()
    const observe = (activity: TActivity): TActivity => ({
      ...activity,
      execute: (ctx, handle) => {
        received = [...received, ctx]
        return activity.execute(ctx, handle)
      },
    })
    const first = fakeActivity('first-writer', [
      { kind: 'accepted', envelope: work('first') },
    ])
    const second = fakeActivity('second-writer', [
      { kind: 'accepted', envelope: work('second') },
    ])
    const empty: TActivity = {
      ...fakeActivity('no-output', []),
      execute: async () => ({ previous: undefined, accepted: true }),
    }
    const annotation = fakeActivity('annotation', [
      { kind: 'accepted', envelope: review('annotation', 1, true) },
    ])

    // when
    const actual = await runUnits({
      run,
      start: seed,
      units: [
        {
          stage: 'parallel',
          strategy: 'concurrent',
          endsStage: true,
          activities: [
            observe(empty),
            observe(annotation),
            observe({
              ...first,
              execute: async (...args: Parameters<TActivity['execute']>) => {
                await secondFinished
                return first.execute(...args)
              },
            }),
            observe({
              ...second,
              execute: async (...args: Parameters<TActivity['execute']>) => {
                const result = await second.execute(...args)
                release()
                return result
              },
            }),
          ],
        },
      ],
    })

    // then
    expect(received).toHaveLength(4)
    expect(
      received.every(
        (ctx) => ctx.previous === original && ctx.previousStep === 'build',
      ),
    ).toBe(true)
    expect(received.map((ctx) => ctx.upstream)).toEqual(
      Array.from({ length: 4 }, () => seed.upstream),
    )
    expect(actual.previous?.summary).toBe('first')
    expect(actual.previousStep).toBe('first-writer')
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'build',
      'annotation',
      'first-writer',
      'second-writer',
    ])
  },
)

test(
  [
    'given issue #108 requirements 1.2.5, 1.3.1 and 1.3.4 and two reviewers in separate Stages',
    'when four revisions produce five rounds of review before approval',
    'it should answer the current verdict, expose both reviewers current evidence, bound history and replay the original writer separately from its reviser',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      {
        name: 'build',
        output: 'buildOutput',
        attempts: 10,
        prompts: shippedPrompts('build'),
      },
      { name: 'functional-check', output: 'reviewOutput' },
      { name: 'safety-check', output: 'reviewOutput' },
    ])
    const { run } = fixture
    const built = work('work v1')
    const { ports, requests, renders } = portsFor((model, attempt) => {
      if (model === 'fixture/build')
        return attempt === 1 ? built : work(`work v${attempt}`)
      const name = model.slice('fixture/'.length)
      return review(name, attempt, attempt === 5)
    })
    const names = ['build', 'functional-check', 'safety-check']
    const ctx = await runActivities({
      run,
      start: contextFor(run),
      activities: runnableActivities(names, run.cfg, {}, ports),
    })

    // when
    const actual = await runReviseLoop(run, {
      names,
      options: {},
      ctx,
      fallbackReason: 'not approved',
      agentPorts: ports,
    })
    const replayedBuild = await runnableActivities(
      ['build'],
      run.cfg,
      {},
      ports,
    )[0]?.replay(contextFor(run))
    const builder = run.cfg.activities.find((one) => one.name === 'build')
    if (builder === undefined) throw new Error('missing fixture builder')
    const replayedRevise = await reviseActivity(builder, {}, ports).replay(
      contextFor(run),
    )

    // then
    const revisions = renders().filter(
      (one) =>
        one.path === join(dirname(shippedPrompts('build').user), 'revise.md'),
    )
    const prompts = requests()
      .filter((one) => one.model === 'fixture/build')
      .slice(1)
    expect(revisions).toHaveLength(4)
    for (const [index, revision] of revisions.entries()) {
      const round = index + 1
      expect(JSON.parse(revision.variables.previous_envelope ?? '{}')).toEqual(
        review('functional-check', round),
      )
      expect(prompts[index]?.prompt).toContain(
        `src/functional-check.ts:${round * 10}`,
      )
      expect(prompts[index]?.prompt).toContain(
        `src/safety-check.ts:${round * 10}`,
      )
      expect(
        revision.variables.previous_envelopes?.match(/^## from /gm),
      ).toHaveLength(round === 1 ? 3 : 4)
    }
    expect(actual.outcome).toBe('approved')
    expect(actual.accepted).toBe(true)
    expect(actual.ctx.upstream.map((one) => one.activity)).toEqual([
      'build',
      'functional-check',
      'safety-check',
      'revise',
    ])
    expect(actual.ctx.upstream.map((one) => one.envelope.summary)).toEqual([
      'work v1',
      'functional-check round 5',
      'safety-check round 5',
      'work v5',
    ])
    expect(actual.ctx.previous).toEqual(work('work v5'))
    expect(actual.ctx.previousStep).toBe('revise')
    expect(replayedBuild?.previous).toEqual(built)
    expect(replayedRevise.previous).toEqual(work('work v5'))
  },
)
