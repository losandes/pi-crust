import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityRun,
  TEnvelopeBase,
  TRun,
} from '../../../../lib/contracts'
import {
  activityRunParams,
  crustConfigSchema,
  EXIT,
  envelopeNamed,
  genericOutput,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { fakeActivity, runWithTracer } from '../../../../testing/fake-activity'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { replayEnvelopeHistory } from './replay-envelope-history'
import { runActivities } from './run-activities'
import { runWorkflow } from './run-workflow'

const ENVELOPE = {
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

const fixtureWith = (activities: readonly Record<string, unknown>[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-replay-history-'))
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  writeFileSync(system, '# System\n')
  writeFileSync(user, '# User\n')
  const entries = activities.map((entry) => ({
    prompt_engineering: { system, user },
    purpose: 'Carry the request through the fixture chain',
    writes: [],
    ...entry,
  }))
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: join(dir, 'data'), protected_files: [] },
    observability: { db: join(dir, 'crust.db') },
    activities: entries,
    agents: entries,
  })
  const run = runWithTracer(dir, cfg)
  run.tracer.sessionStart(run.runId, 'tester', 'compose')
  silenceTerminal()

  return {
    dir,
    run,
    [Symbol.dispose]: () => {
      run.tracer.close()
      rmSync(dir, { recursive: true, force: true })
      restoreTerminal()
    },
  }
}

const planted = (
  run: TRun,
  params: Readonly<{
    name: string
    seq: number
    envelope: TEnvelopeBase
    owner?: string
    output?: string
    status?: TActivityRun['status']
  }>,
): void => {
  const owner = params.owner ?? params.name
  const spec = envelopeNamed(params.output ?? 'genericOutput') ?? genericOutput
  const row: TActivityRun = {
    activity_run_id: `${run.runId}_${params.seq}_${params.name}`,
    run_id: run.runId,
    seq: params.seq,
    params: activityRunParams({
      name: params.name,
      kind: 'agent',
      owner,
      description: 'Produce an envelope for a resumed consumer',
    }),
    status: params.status ?? 'success',
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
  }
  run.tracer.activityRunUpsert(row)
  run.tracer.envelopeRow(
    row,
    owner,
    spec.name,
    JSON.stringify(params.envelope),
    true,
  )
  const directory = join(run.sessionDir, owner)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'envelope.json'),
    JSON.stringify({
      agent_name: owner,
      purpose: 'fixture',
      output_type: spec.name,
      ...params.envelope,
    }),
  )
}

test(
  [
    'given persisted envelopes whose files were written out of trace order',
    'when a run history is reconstructed',
    'it should retain every participant in trace order and select work rather than an annotating verdict',
  ].join(', '),
  () => {
    // given
    using fixture = fixtureWith([
      { name: 'identify', output: 'genericOutput' },
      { name: 'conceptualize', output: 'genericOutput' },
      { name: 'custom-review', output: 'reviewOutput' },
    ])
    const { run } = fixture
    planted(run, {
      name: 'custom-review',
      seq: 3,
      output: 'reviewOutput',
      envelope: reviewOutputSchema.parse({
        ...ENVELOPE,
        findings: [],
        blocking: [],
        approved: true,
      }),
    })
    planted(run, {
      name: 'conceptualize',
      seq: 2,
      envelope: { ...ENVELOPE, summary: 'logical architecture' },
    })
    planted(run, {
      name: 'identify',
      seq: 1,
      envelope: { ...ENVELOPE, summary: 'success criteria' },
    })

    // when
    const actual = replayEnvelopeHistory(run)

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'identify',
      'conceptualize',
      'custom-review',
    ])
    expect(actual.upstream[0]?.envelope.summary).toBe('success criteria')
    expect(actual.previous?.summary).toBe('logical architecture')
    expect(actual.previousStep).toBe('conceptualize')
  },
)

for (const later of [false, true]) {
  test(
    [
      'given persisted superseding siblings from a concurrent Unit',
      `when resume ${later ? 'also has a later serial result' : 'reaches their Stage boundary'}`,
      'it should retain the same deterministic primary that the live fold chose',
    ].join(', '),
    () => {
      // given
      using fixture = fixtureWith([
        { name: 'first-writer', output: 'genericOutput' },
        { name: 'second-writer', output: 'genericOutput' },
        { name: 'later-writer', output: 'genericOutput' },
      ])
      const { run } = fixture
      planted(run, {
        name: 'first-writer',
        seq: 1,
        envelope: { ...ENVELOPE, summary: 'first' },
      })
      planted(run, {
        name: 'second-writer',
        seq: 2,
        envelope: { ...ENVELOPE, summary: 'second' },
      })
      if (later)
        planted(run, {
          name: 'later-writer',
          seq: 3,
          envelope: { ...ENVELOPE, summary: 'later' },
        })
      const unit = {
        stage: 'produce',
        strategy: 'concurrent' as const,
        endsStage: true,
        activities: ['first-writer', 'second-writer'].map((name) =>
          fakeActivity(name, []),
        ),
      }

      // when
      const actual = replayEnvelopeHistory(run, [unit])

      // then
      expect(actual.previous?.summary).toBe(later ? 'later' : 'first')
      expect(actual.previousStep).toBe(later ? 'later-writer' : 'first-writer')
    },
  )
}

test(
  [
    'given numbered reruns of an earlier superseding participant',
    'when its latest envelope is restored from the session directory',
    'it should keep its first position without confusing history order with the most recent superseding work',
  ].join(', '),
  () => {
    // given
    using fixture = fixtureWith([
      { name: 'writer', output: 'genericOutput' },
      { name: 'other-writer', output: 'genericOutput' },
    ])
    const { run } = fixture
    planted(run, {
      name: 'writer',
      seq: 1,
      envelope: { ...ENVELOPE, summary: 'first version' },
    })
    planted(run, {
      name: 'other-writer',
      seq: 2,
      envelope: { ...ENVELOPE, summary: 'other work' },
    })
    for (const round of [2, 3, 4, 5]) {
      planted(run, {
        name: `writer_${round}`,
        owner: 'writer',
        seq: round + 1,
        envelope: { ...ENVELOPE, summary: `version ${round}` },
      })
    }

    // when
    const actual = replayEnvelopeHistory(run)

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'writer',
      'other-writer',
    ])
    expect(actual.previous?.summary).toBe('version 5')
    expect(actual.previousStep).toBe('writer')
    expect(actual.upstream[0]?.envelope.summary).toBe('version 5')
  },
)

test(
  [
    'given an engine-controlled Planner with no Activity output declaration',
    'when it has a valid persisted envelope in the trace',
    'it should recover its full contract from the traced output type',
  ].join(', '),
  () => {
    // given
    using fixture = fixtureWith([])
    const { run } = fixture
    planted(run, {
      name: 'operator',
      seq: 1,
      output: 'operatorPlanOutput',
      envelope: {
        ...ENVELOPE,
        summary: 'selected the chain',
        steps: ['build'],
      } as TEnvelopeBase,
    })

    // when
    const actual = replayEnvelopeHistory(run)

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual(['operator'])
    expect(actual.previous).toMatchObject({
      summary: 'selected the chain',
      steps: ['build'],
    })
  },
)

for (const broken of ['missing', 'invalid']) {
  test(
    [
      'given a successful Activity Run in the trace',
      `when its session envelope is ${broken}`,
      'it should refuse resume rather than silently dropping established context',
    ].join(', '),
    () => {
      // given
      using fixture = fixtureWith([{ name: 'writer', output: 'genericOutput' }])
      const { run } = fixture
      planted(run, { name: 'writer', seq: 1, envelope: ENVELOPE })
      const path = join(run.sessionDir, 'writer', 'envelope.json')
      if (broken === 'missing') {
        rmSync(path)
      } else {
        writeFileSync(path, 'not JSON')
      }

      // when, then
      expect(() => replayEnvelopeHistory(run)).toThrow(
        "cannot resume history for 'writer'",
      )
    },
  )
}

test(
  [
    'given an empty trace and a failed agent that never produced an envelope',
    'when history is reconstructed',
    'it should return no previous work or invented history entry',
  ].join(', '),
  () => {
    // given
    using fixture = fixtureWith([{ name: 'writer', output: 'genericOutput' }])
    const { run } = fixture
    const row: TActivityRun = {
      activity_run_id: 'failed-agent',
      run_id: run.runId,
      seq: 1,
      params: activityRunParams({
        name: 'writer',
        owner: 'writer',
        kind: 'agent',
        description: 'Fail before producing an envelope',
      }),
      status: 'fail',
      error: 'fixture failure',
      started_at: undefined,
      ended_at: undefined,
    }
    run.tracer.activityRunUpsert(row)
    run.tracer.activityRunUpsert({
      ...row,
      activity_run_id: 'code-row',
      seq: 2,
      params: activityRunParams({
        name: 'request',
        owner: 'tester',
        kind: 'engineer',
        description: 'Capture the request',
      }),
      status: 'success',
    })

    // when
    const actual = replayEnvelopeHistory(run)

    // then
    expect(actual).toEqual({
      previous: undefined,
      previousStep: undefined,
      upstream: [],
    })
  },
)

test(
  [
    'given --resume with a sub-chain that starts after earlier Activities',
    'when the next Activity executes through runWorkflow',
    'it should render the trace-ordered persisted history, not start with empty context',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([
      { name: 'identify', output: 'genericOutput' },
      { name: 'conceptualize', output: 'genericOutput' },
      { name: 'plan', output: 'genericOutput' },
    ])
    const { run, dir } = fixture
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Tester',
        '-c',
        'user.email=tester@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-qm',
        'Initial fixture',
      ],
      { cwd: dir },
    )
    planted(run, {
      name: 'conceptualize',
      seq: 2,
      envelope: { ...ENVELOPE, summary: 'the architecture' },
    })
    planted(run, {
      name: 'identify',
      seq: 1,
      envelope: { ...ENVELOPE, summary: 'the criteria' },
    })
    run.tracer.sessionFinish(run.runId, false)
    const config = join(dir, 'crust.config.yaml')
    writeFileSync(config, Bun.YAML.stringify(run.cfg))
    let rendered: Readonly<Record<string, string>> = {}
    const ports: TAgentPorts = {
      run: async () => ({
        text: JSON.stringify(ENVELOPE),
        returncode: 0,
        sessionId: 'fixture',
        tokens: 0,
        cost: 0,
        usage: emptyUsage,
        contextTokens: 0,
        contextWindow: 0,
      }),
      changed: () => [],
      untracked: () => [],
      render: (path, variables) => {
        rendered = variables
        return path
      },
      savePrompt: (directory, name) => join(directory, name),
      snapshot: () => ({}),
      rev: () => '',
      content: () => ({ status: 'ok', data: {} }),
    }
    const cwd = process.cwd()
    const environment = {
      machine: process.env.CRUST_MACHINE_CONFIG ?? '',
      data: process.env.CRUST_DATA_DIR ?? '',
      registry: process.env.CRUST_REGISTRY ?? '',
    }
    process.chdir(dir)
    // biome-ignore lint/plugin/no-object-mutation: process.env is the configuration boundary this isolated fixture owns
    process.env.CRUST_MACHINE_CONFIG = join(dir, 'no-machine-config.yaml')
    // biome-ignore lint/plugin/no-object-mutation: process.env is the configuration boundary this isolated fixture owns
    process.env.CRUST_DATA_DIR = ''
    // biome-ignore lint/plugin/no-object-mutation: process.env is the configuration boundary this isolated fixture owns
    process.env.CRUST_REGISTRY = join(dir, 'workspaces.jsonl')
    try {
      // when
      const actual = await runWorkflow(
        {
          prompt: 'plan the work',
          config,
          runId: run.runId,
          resume: true,
          base: undefined,
          activities: undefined,
          lifecycle: undefined,
          models: undefined,
          approveAfter: undefined,
          commit: undefined,
          stream: false,
          trustLevel: undefined,
          handoff: undefined,
          name: undefined,
        },
        [{ name: 'continue', strategy: 'serial', activities: ['plan'] }],
        ports,
        () => ({ provider: 'fixture', modelId: 'fixture-model' }),
        async () => false,
      )

      // then
      expect(actual).toBe(EXIT.SUCCESS)
      expect(JSON.parse(rendered.previous_envelope ?? '{}').summary).toBe(
        'the architecture',
      )
      const history = rendered.previous_envelopes ?? ''
      expect(history).toContain('the criteria')
      expect(history).toContain('the architecture')
      expect(history.indexOf('## from identify')).toBeLessThan(
        history.indexOf('## from conceptualize'),
      )
    } finally {
      process.chdir(cwd)
      // biome-ignore lint/plugin/no-object-mutation: restore the process environment owned by this fixture
      process.env.CRUST_MACHINE_CONFIG = environment.machine
      // biome-ignore lint/plugin/no-object-mutation: restore the process environment owned by this fixture
      process.env.CRUST_DATA_DIR = environment.data
      // biome-ignore lint/plugin/no-object-mutation: restore the process environment owned by this fixture
      process.env.CRUST_REGISTRY = environment.registry
    }
  },
)

test(
  [
    'given a resumed chain replaying earlier successful Activities',
    'when their results are folded forward without executing their bodies',
    'it should rebuild history from those envelopes and pass all of it to the next Activity',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith([])
    const { run } = fixture
    const replaying = {
      ...run,
      claimResume: () => true,
    }
    const first = fakeActivity('identify', [
      { kind: 'accepted', envelope: { ...ENVELOPE, summary: 'identified' } },
    ])
    const second = fakeActivity('conceptualize', [
      {
        kind: 'accepted',
        envelope: { ...ENVELOPE, summary: 'conceptualized' },
      },
    ])

    // when
    const actual = await runActivities({
      run: replaying,
      activities: [first, second],
      start: {
        run: replaying,
        prompt: 'x',
        previous: undefined,
        previousStep: undefined,
        upstream: [],
        cohort: [],
        baseline: '',
        outcomes: [],
        feedback: [],
      },
    })

    // then
    expect(actual.upstream.map((one) => one.activity)).toEqual([
      'identify',
      'conceptualize',
    ])
    expect(actual.previousStep).toBe('conceptualize')
    expect(actual.previous?.summary).toBe('conceptualized')
  },
)
