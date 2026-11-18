import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivity,
  TActivityContext,
  TEnvelopeBase,
  TRun,
} from '../../../../lib/contracts'
import {
  buildOutputSchema,
  crustConfigSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { fakeActivity, runWithTracer } from '../../../../testing/fake-activity'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { runnableActivities } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { readLedger } from '../../../gates'
import { createRun } from './create-run'
import { replayEnvelopeHistory } from './replay-envelope-history'
import { reviseActivity, runReviseLoop } from './revise-loop'
import { runActivities, runUnits } from './run-activities'

const fixtureWith = (activities: readonly Record<string, unknown>[] = []) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-envelope-succession-'))
  const entries = activities.map((entry) => ({
    prompt_engineering: { system: 's.md', user: 'u.md' },
    writes: [],
    ...entry,
  }))
  const created = runWithTracer(
    dir,
    crustConfigSchema.parse({
      defaults: { data_dir: join(dir, 'data') },
      observability: { db: join(dir, 'crust.db') },
      activities: entries,
      agents: entries,
    }),
  )

  const run = { ...created, repoRoot: dir, vcsRoot: dir }
  run.tracer.sessionStart(run.runId, 'tester', 'compose')
  silenceTerminal()
  return {
    run,
    [Symbol.dispose]: () => {
      run.tracer.close()
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

const CONTEXT = {
  status: 'success',
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

const work = (summary: string): TEnvelopeBase =>
  buildOutputSchema.parse({
    ...CONTEXT,
    summary,
    changed_files: ['src/work.ts'],
  })

const verdict = (summary: string): TEnvelopeBase =>
  reviewOutputSchema.parse({
    ...CONTEXT,
    summary,
    approved: true,
    findings: [],
    blocking: [],
  })

const observedActivity = (name: string, envelope: TEnvelopeBase) => {
  const activity = fakeActivity(name, [{ kind: 'accepted', envelope }])
  let contexts: readonly TActivityContext[] = []

  return {
    activity: {
      ...activity,
      execute: (
        ctx: TActivityContext,
        handle: Parameters<TActivity['execute']>[1],
      ) => {
        contexts = [...contexts, ctx]
        return activity.execute(ctx, handle)
      },
    },
    contexts: () => contexts,
  }
}

test(
  [
    'given a serial identify, conceptualize, plan chain',
    'when the planner is reached',
    'it should receive both earlier envelopes and the same immediate work as a chain without annotations',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith()
    const { run } = fixture
    const identify = observedActivity('identify', work('identified'))
    const conceptualize = observedActivity(
      'conceptualize',
      work('conceptualized'),
    )
    const plan = observedActivity('plan', work('planned'))

    // when
    const actual = await runActivities({
      run,
      activities: [identify.activity, conceptualize.activity, plan.activity],
      start: contextFor(run),
    })

    // then
    expect(identify.contexts()[0]?.previous).toBeUndefined()
    expect(conceptualize.contexts()[0]?.previous?.summary).toBe('identified')
    expect(plan.contexts()[0]?.previous?.summary).toBe('conceptualized')
    expect(plan.contexts()[0]?.previousStep).toBe('conceptualize')
    expect(plan.contexts()[0]?.upstream.map((one) => one.activity)).toEqual([
      'identify',
      'conceptualize',
    ])
    expect(actual.previous?.summary).toBe('planned')
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'identify',
      'conceptualize',
      'plan',
    ])
  },
)

test(
  [
    'given two judging Activities with custom names in serial Stages',
    'when a consumer follows both',
    'it should read the work as previous and retain both complete verdicts in history',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      { name: 'requirements-check', output: 'reviewOutput' },
      { name: 'style-check', output: 'reviewOutput' },
    ])
    const { run } = fixture
    const built = work('built')
    const first = observedActivity(
      'requirements-check',
      verdict('first evidence'),
    )
    const second = observedActivity('style-check', verdict('second evidence'))
    const consumer = observedActivity('documenter', work('documented'))

    // when
    await runActivities({
      run,
      activities: [
        fakeActivity('build', [{ kind: 'accepted', envelope: built }]),
        first.activity,
        second.activity,
        consumer.activity,
      ],
      start: contextFor(run),
    })

    // then
    expect(first.contexts()[0]?.previous).toBe(built)
    expect(second.contexts()[0]?.previous).toBe(built)
    expect(second.contexts()[0]?.previousStep).toBe('build')
    const received = consumer.contexts()[0]
    expect(received?.previous).toBe(built)
    expect(received?.previousStep).toBe('build')
    expect(received?.upstream.map((one) => one.envelope.summary)).toEqual([
      'built',
      'first evidence',
      'second evidence',
    ])
  },
)

const concurrentCases = [
  {
    name: 'two superseding Activities',
    entries: [
      { name: 'first', output: 'buildOutput' },
      { name: 'second', output: 'buildOutput' },
    ],
    expected: 'first',
  },
  {
    name: 'an annotator followed by a superseding Activity',
    entries: [
      { name: 'first', output: 'reviewOutput' },
      { name: 'second', output: 'buildOutput' },
    ],
    expected: 'second',
  },
  {
    name: 'only annotating Activities',
    entries: [
      { name: 'first', output: 'reviewOutput' },
      { name: 'second', output: 'genericOutput', succession: 'annotates' },
    ],
    expected: undefined,
  },
]

for (const given of concurrentCases) {
  test(
    [
      'given a concurrent Unit',
      `when it contains ${given.name}`,
      'it should select the first superseding result in declaration order, or no previous if none exists',
    ].join(', '),
    async () => {
      // given
      using fixture = fixtureWith(given.entries)
      const { run } = fixture
      const activities = given.entries.map((entry) =>
        fakeActivity(entry.name, [
          { kind: 'accepted', envelope: work(entry.name) },
        ]),
      )
      const first = activities[0]
      const delayed =
        first === undefined
          ? []
          : [
              {
                ...first,
                execute: async (...args: Parameters<TActivity['execute']>) => {
                  await new Promise((resolve) => setTimeout(resolve, 5))
                  return first.execute(...args)
                },
              },
            ]

      // when
      const actual = await runUnits({
        run,
        units: [
          {
            stage: 'concurrent',
            strategy: 'concurrent',
            activities: [...delayed, ...activities.slice(1)],
            endsStage: true,
          },
        ],
        start: contextFor(run),
      })

      // then
      expect(actual.previousStep).toBe(given.expected)
      expect(actual.previous?.summary).toBe(given.expected)
      expect(actual.upstream.map((one) => one.activity)).toEqual([
        'first',
        'second',
      ])
    },
  )
}

test(
  [
    'given a five-round sequence that repeats the same writer and reviewers',
    'when each participant produces a newer envelope',
    'it should retain one latest envelope per participant in first-production order',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      { name: 'first-review', output: 'reviewOutput' },
      { name: 'second-review', output: 'reviewOutput' },
    ])
    const { run } = fixture
    const participants = ['writer', 'first-review', 'second-review']
    const activities = Array.from({ length: 5 }, (_, round) =>
      participants.map((name) => ({
        ...fakeActivity(name, [
          {
            kind: 'accepted',
            envelope: work(`${name} round ${round + 1}`),
          },
        ]),
        instance: `${name}_${round + 1}`,
      })),
    ).flat()

    // when
    const actual = await runActivities({
      run,
      activities,
      start: contextFor(run),
    })

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual(participants)
    expect(actual.upstream.map((one) => one.envelope.summary)).toEqual([
      'writer round 5',
      'first-review round 5',
      'second-review round 5',
    ])
    expect(actual.previousStep).toBe('writer')
    expect(actual.previous?.summary).toBe('writer round 5')
  },
)

test(
  [
    'given an Activity whose result has no envelope',
    'when it follows superseding work',
    'it should not erase the previous work or its history',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith()
    const { run } = fixture
    const built = work('built')
    const empty = {
      ...fakeActivity('empty', []),
      execute: async () => ({ previous: undefined, accepted: true }),
    }

    // when
    const actual = await runActivities({
      run,
      activities: [
        fakeActivity('build', [{ kind: 'accepted', envelope: built }]),
        empty,
      ],
      start: contextFor(run),
    })

    // then
    expect(actual.previous).toBe(built)
    expect(actual.previousStep).toBe('build')
    expect(actual.upstream).toEqual([{ activity: 'build', envelope: built }])
  },
)

const portsFor = (response: (template: string) => TEnvelopeBase) => {
  let renders: readonly Readonly<{
    path: string
    variables: Readonly<Record<string, string>>
  }>[] = []
  const ports: TAgentPorts = {
    run: async (request) => ({
      text: JSON.stringify(response(request.systemPrompt)),
      returncode: 0,
      sessionId: 'fixture-session',
      tokens: 0,
      cost: 0,
      usage: emptyUsage,
      contextTokens: 0,
      contextWindow: 0,
    }),
    changed: () => ['unrelated-working-tree.ts'],
    untracked: () => [],
    render: (path, variables) => {
      renders = [...renders, { path, variables }]
      return path
    },
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
  }

  return {
    ports,
    renders: () => renders.filter((one) => one.path.endsWith('/user')),
  }
}

const agentEntry = (name: string, output: string) => ({
  name,
  output,
  purpose: `Run ${name} against the upstream work`,
  prompt_engineering: { system: `${name}/system`, user: `${name}/user` },
})

test(
  [
    'given a build followed by a concurrent review Stage',
    'when both reviewers run through the real agent boundary',
    'it should use the working tree without a run start and preserve both verdicts for downstream consumers',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      agentEntry('build', 'buildOutput'),
      agentEntry('requirements-check', 'reviewOutput'),
      agentEntry('style-check', 'reviewOutput'),
    ])
    const { run } = fixture
    const built = work('built')
    const { ports, renders } = portsFor((template) => verdict(template))
    const reviews = runnableActivities(
      ['requirements-check', 'style-check'],
      run.cfg,
      {},
      ports,
    )

    // when
    const actual = await runUnits({
      run,
      units: [
        {
          stage: 'implement',
          strategy: 'serial',
          activities: [
            fakeActivity('build', [{ kind: 'accepted', envelope: built }]),
          ],
          endsStage: true,
        },
        {
          stage: 'accept',
          strategy: 'concurrent',
          activities: reviews,
          endsStage: true,
        },
      ],
      start: contextFor(run),
    })

    // then
    expect(renders().map((one) => one.variables.changed_files)).toEqual([
      'unrelated-working-tree.ts',
      'unrelated-working-tree.ts',
    ])
    expect(
      renders().map(
        (one) => JSON.parse(one.variables.previous_envelope ?? '{}').summary,
      ),
    ).toEqual(['built', 'built'])
    expect(actual.previous).toBe(built)
    expect(actual.previousStep).toBe('build')
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'build',
      'requirements-check',
      'style-check',
    ])
  },
)

test(
  [
    'given a writer and two rejecting reviewers from separate Stages',
    'when the revise loop answers their verdicts',
    'it should hand the reviser a review explicitly, retain both reviewers evidence, and record both in the opening round',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      agentEntry('build', 'buildOutput'),
      agentEntry('requirements-check', 'reviewOutput'),
      agentEntry('style-check', 'reviewOutput'),
    ])
    const { run } = fixture
    const built = work('original work')
    const revisions = buildOutputSchema.parse({
      ...CONTEXT,
      summary: 'revised work',
      changed_files: ['src/fixed.ts'],
    })
    const rejected = (name: string) =>
      reviewOutputSchema.parse({
        ...CONTEXT,
        summary: `${name} rejected`,
        approved: false,
        blocking: [`${name} finding`],
        findings: [
          {
            requirement: `${name} finding`,
            met: false,
            evidence: `src/${name}.ts:42`,
          },
        ],
      })
    const first = rejected('requirements-check')
    const second = rejected('style-check')
    let builds = 0
    let reviews: Readonly<Record<string, number>> = {}
    const { ports, renders } = portsFor((template) => {
      if (template.startsWith('build/')) {
        builds += 1
        return builds === 1 ? built : revisions
      }
      const count = (reviews[template] ?? 0) + 1
      reviews = { ...reviews, [template]: count }
      return count > 1
        ? verdict('approved')
        : template.startsWith('requirements-check/')
          ? first
          : second
    })
    const ctx = await runActivities({
      run,
      activities: runnableActivities(
        ['build', 'requirements-check', 'style-check'],
        run.cfg,
        {},
        ports,
      ),
      start: contextFor(run),
    })

    // when
    const actual = await runReviseLoop(run, {
      names: ['build', 'requirements-check', 'style-check'],
      options: {},
      ctx,
      fallbackReason: 'not accepted',
      agentPorts: ports,
    })

    // then
    const builder = renders()
      .filter((one) => one.path === 'build/user')
      .at(-1)?.variables
    expect(JSON.parse(builder?.previous_envelope ?? '{}')).toEqual(first)
    expect(builder?.previous_envelopes).toContain(
      'src/requirements-check.ts:42',
    )
    expect(builder?.previous_envelopes).toContain('src/style-check.ts:42')
    expect(readLedger(run)[0]?.blocking).toEqual([
      'requirements-check finding',
      'style-check finding',
    ])
    expect(readLedger(run)[0]?.evidence).toEqual({
      'requirements-check finding': 'src/requirements-check.ts:42',
      'style-check finding': 'src/style-check.ts:42',
    })
    expect(actual.outcome).toBe('approved')
    expect(actual.ctx.previous?.summary).toBe('revised work')
    expect(actual.ctx.previousStep).toBe('revise')
    expect(actual.ctx.upstream.map((one) => one.activity)).toEqual([
      'build',
      'requirements-check',
      'style-check',
      'revise',
    ])
    expect(
      renders()
        .filter((one) => one.path !== 'build/user')
        .slice(-2)
        .map(
          (one) => JSON.parse(one.variables.previous_envelope ?? '{}').summary,
        ),
    ).toEqual(['revised work', 'revised work'])
    const restored = replayEnvelopeHistory(run)
    expect(restored.upstream).toEqual(actual.ctx.upstream)
    expect(
      restored.upstream.find((one) => one.activity === 'build')?.envelope
        .summary,
    ).toBe('original work')
    expect(restored.previous?.summary).toBe('revised work')
    expect(restored.previousStep).toBe('revise')
    const resuming = createRun({
      cfg: run.cfg,
      runId: run.runId,
      tracer: run.tracer,
      engineer: 'tester',
      resume: new Set(['build', 'requirements-check', 'style-check']),
    })
    const activities = runnableActivities(
      ['build', 'requirements-check', 'style-check'],
      run.cfg,
      {},
      ports,
    )
    const replayedBuild = await activities[0]?.replay({
      ...contextFor(resuming),
      ...restored,
    })
    expect(replayedBuild?.previous?.summary).toBe('original work')
    const replayed = await runActivities({
      run: resuming,
      activities,
      start: { ...contextFor(resuming), ...restored },
    })
    expect(replayed.upstream).toEqual(restored.upstream)
    expect(replayed.previous?.summary).toBe('revised work')
    expect(replayed.previousStep).toBe('revise')
    const writer = run.cfg.activities[0]
    if (writer === undefined) throw new Error('missing fixture writer')
    const revisedReplay = await reviseActivity(writer, {}, ports).replay(
      contextFor(resuming),
    )
    expect(revisedReplay.previous?.summary).toBe('revised work')
  },
)
