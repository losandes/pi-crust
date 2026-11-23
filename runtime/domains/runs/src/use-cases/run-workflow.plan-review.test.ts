import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TEnvelopeBase, TStage } from '../../../../lib/contracts'
import {
  buildOutputSchema,
  EXIT,
  planOutputSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { configText } from '../../../../testing/config-document'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { loadConfig } from '../../../config'
import { attemptLedger } from './attempts'
import { runPlannedChain, runWorkflow } from './run-workflow'
import { startSession } from './start-session'

const CONTEXT = {
  status: 'success' as const,
  facts: [],
  decisions: [],
  assumptions: [],
  unresolved: [],
  risks: [],
  objective_met: { met: true, evidence: 'fixture' },
  regress_to: { activity: '', because: '' },
}

const fixtureWith = (
  response: (name: string, attempt: number) => TEnvelopeBase,
  planAttempts = 3,
) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-workflow-plan-review-'))
  const keys = ['CRUST_MACHINE_CONFIG', 'CRUST_DATA_DIR'] as const
  const before = keys.map((key) => [key, process.env[key]] as const)
  // biome-ignore lint/plugin/no-object-mutation: this fixture owns the environment adapter loadConfigWithNotes reads
  process.env.CRUST_MACHINE_CONFIG = join(dir, 'absent-machine')
  // biome-ignore lint/plugin/no-object-mutation: this fixture owns the environment adapter resolveDataPaths reads
  process.env.CRUST_DATA_DIR = join(dir, 'data')
  const system = join(dir, 'system.md')
  const user = join(dir, 'user.md')
  writeFileSync(system, '# System\n')
  writeFileSync(user, '# User\n')
  const activities = [
    { name: 'plan', output: 'planOutput', attempts: planAttempts },
    { name: 'plan-comprehension', output: 'reviewOutput' },
    { name: 'plan-readiness', output: 'reviewOutput' },
    { name: 'build', output: 'buildOutput' },
    { name: 'test', output: 'buildOutput', attempts: 2 },
    { name: 'code-review', output: 'reviewOutput' },
    { name: 'gh-issue', output: 'genericOutput' },
  ].map((entry) => ({
    ...entry,
    model: `fixture/${entry.name}`,
    purpose: `Exercise ${entry.name} against the preceding work`,
    writes: [],
    prompts: dirname(system),
  }))
  const config = join(dir, 'pi-crust.toml')
  writeFileSync(
    config,
    configText({
      defaults: { data_dir: join(dir, 'data') },
      observability: {},
      activities,
      agents: activities,
    }),
  )
  const attempts = new Map<string, number>()
  let calls: readonly string[] = []
  let builtFrom: TEnvelopeBase | undefined
  const ports: TAgentPorts = {
    run: (request) => {
      const name = request.model.slice('fixture/'.length)
      const attempt = (attempts.get(name) ?? 0) + 1
      attempts.set(name, attempt)
      calls = [...calls, name]
      if (name === 'build')
        builtFrom = JSON.parse(JSON.parse(request.prompt).previous_envelope)
      return Promise.resolve({
        text: JSON.stringify(
          name === 'test'
            ? (() => {
                const report = response(name, attempt)
                const path = join(dir, 'work.test.ts')
                writeFileSync(path, 'test fixture\n')
                return { ...report, changed_files: [path] }
              })()
            : response(name, attempt),
        ),
        returncode: 0,
        sessionId: 'fixture',
        tokens: 0,
        cost: 0,
        usage: emptyUsage,
        contextTokens: 0,
        contextWindow: 0,
      })
    },
    changed: () => [],
    untracked: () => [],
    render: (_path, variables) => JSON.stringify(variables),
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    head: () => '',
    history: () => () => [],
    content: () => ({ status: 'ok', data: {} }),
  }
  silenceTerminal()
  return {
    ports,
    args: {
      prompt: 'implement the request',
      config,
      commit: 'false',
      trustLevel: '100',
      runId: 'abcd1234',
      base: undefined,
      resume: false,
      activities: undefined,
      lifecycle: undefined,
      models: undefined,
      approveAfter: undefined,
      stream: false,
      handoff: undefined,
      name: undefined,
    },
    calls: () => calls,
    builtFrom: () => builtFrom,
    rounds: (filename: string): unknown =>
      JSON.parse(
        readFileSync(
          join(
            dir,
            'data',
            'sessions',
            'abcd1234',
            'context_handoff',
            filename,
          ),
          'utf8',
        ),
      ),
    [Symbol.dispose]: () => {
      for (const [key, value] of before) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          // biome-ignore lint/plugin/no-array-mutation: this fixture owns the process.env integration boundary and must restore its values
          process.env[key] = value
        }
      }
      rmSync(dir, { recursive: true, force: true })
      restoreTerminal()
    },
  }
}

const response =
  (approves: (attempt: number, name: string) => boolean) =>
  (name: string, attempt: number): TEnvelopeBase => {
    if (name === 'plan') {
      return planOutputSchema.parse({
        ...CONTEXT,
        summary: `plan v${attempt}`,
        changed_files: ['handoff/plan.md'],
      })
    }
    if (name === 'build' || name === 'test')
      return buildOutputSchema.parse({ ...CONTEXT, changed_files: [] })
    const approved = approves(attempt, name)
    return reviewOutputSchema.parse({
      ...CONTEXT,
      approved,
      blocking: approved ? [] : ['name the files'],
      findings: approved
        ? []
        : [
            {
              requirement: 'name the files',
              met: false,
              evidence: 'plan.md:10',
            },
          ],
    })
  }

const STAGES: readonly TStage[] = [
  { name: 'discover', strategy: 'serial', activities: ['plan'] },
  {
    name: 'review-plan',
    strategy: 'concurrent',
    activities: ['plan-comprehension', 'plan-readiness'],
  },
  { name: 'deliver', strategy: 'serial', activities: ['build', 'gh-issue'] },
]

test(
  [
    'given runWorkflow with a plan review before later work',
    'when a configured chain exhausts plan revisions',
    'it should finish not-accepted without building or filing an issue',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith(response(() => false))

    // when
    const actual = await runWorkflow(
      fixture.args,
      STAGES,
      fixture.ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
    )

    // then
    expect(actual).toBe(EXIT.FAILED)
    expect(fixture.calls()).not.toContain('build')
    expect(fixture.calls()).not.toContain('gh-issue')
    expect(fixture.calls().filter((name) => name === 'plan')).toHaveLength(4)
  },
)

test(
  [
    'given an operator-chosen chain with a plan review before build',
    'when runPlannedChain exhausts the plan revisions',
    'it should stop that chain at the same review boundary',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith(response(() => false))
    const run = startSession(
      loadConfig(fixture.args.config),
      fixture.args.runId,
    )
    using _session = { [Symbol.dispose]: () => run.tracer.close() }

    // when
    const actual = await runPlannedChain(
      run,
      ['plan', 'plan-comprehension', 'plan-readiness', 'build'],
      { committing: false },
      {
        run,
        prompt: fixture.args.prompt,
        previous: undefined,
        previousStep: undefined,
        upstream: [],
        cohort: [],
        baseline: '',
        outcomes: [],
        feedback: [],
      },
      fixture.args,
      100,
      attemptLedger(),
      fixture.ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
    )

    // then
    expect(actual).toBeDefined()
    expect(fixture.calls()).not.toContain('build')
    expect(fixture.calls().filter((name) => name === 'plan')).toHaveLength(4)
  },
)

test(
  [
    'given a human approval gate at the plan-review Stage boundary',
    'when the reviewers finish with later work still pending',
    'it should wait before opening a revise loop or starting build',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith(response(() => false))

    // when
    const actual = await runWorkflow(
      { ...fixture.args, approveAfter: 'stage:review-plan' },
      STAGES,
      fixture.ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
    )

    // then
    expect(actual).toBe(EXIT.WAITING)
    expect(fixture.calls()).toEqual([
      'plan',
      'plan-comprehension',
      'plan-readiness',
    ])
  },
)

test(
  [
    'given runWorkflow with plan reviewers that approve a revision',
    'when the next segment starts',
    'it should give build the approved plan and settle the whole run accepted',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith(response((attempt) => attempt > 1))

    // when
    const actual = await runWorkflow(
      fixture.args,
      STAGES.slice(0, 2).concat({
        name: 'deliver',
        strategy: 'serial',
        activities: ['build'],
      }),
      fixture.ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
    )

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.calls()).toEqual([
      'plan',
      'plan-comprehension',
      'plan-readiness',
      'plan',
      'plan-comprehension',
      'plan-readiness',
      'build',
    ])
    expect(fixture.builtFrom()?.summary).toBe('plan v2')
  },
)

test(
  [
    'given issue #105 plan reviewers that approve on alternate rounds',
    'when each has approved before but they never approve the same plan',
    'it should exhaust the plan budget without building or filing an issue',
  ].join(', '),
  async () => {
    // given — 1.4.2 and 1.6.11 require both current verdicts, not historical approvals.
    using fixture = fixtureWith(
      response((attempt, name) =>
        name === 'plan-comprehension' ? attempt % 2 === 0 : attempt % 2 === 1,
      ),
    )

    // when
    const actual = await runWorkflow(
      fixture.args,
      STAGES,
      fixture.ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
    )

    // then
    expect(actual).toBe(EXIT.FAILED)
    expect(fixture.calls()).not.toContain('build')
    expect(fixture.calls()).not.toContain('gh-issue')
    expect(fixture.calls().filter((name) => name === 'plan')).toHaveLength(4)
    expect(
      fixture.calls().filter((name) => name === 'plan-comprehension'),
    ).toHaveLength(4)
    expect(
      fixture.calls().filter((name) => name === 'plan-readiness'),
    ).toHaveLength(4)
    expect(fixture.rounds('disputes-plan.json')).toMatchObject([
      {
        round: 1,
        reviewers: {
          'plan-comprehension': ['name the files'],
          'plan-readiness': [],
        },
      },
      {
        round: 2,
        reviewers: {
          'plan-comprehension': [],
          'plan-readiness': ['name the files'],
        },
      },
      {
        round: 3,
        reviewers: {
          'plan-comprehension': ['name the files'],
          'plan-readiness': [],
        },
      },
      {
        round: 4,
        reviewers: {
          'plan-comprehension': [],
          'plan-readiness': ['name the files'],
        },
      },
    ])
  },
)

test(
  [
    'given issue #105 groups that both revise the same planner',
    'when each needs the only revision its planner permits',
    'it should give each group its own budget and persisted conversation',
  ].join(', '),
  async () => {
    // given — 1.5 makes budgets and ledgers per group, not merely per writer.
    using fixture = fixtureWith(
      response((attempt) => attempt > 1),
      1,
    )
    const stages: readonly TStage[] = [
      { name: 'first-plan', strategy: 'serial', activities: ['plan'] },
      {
        name: 'comprehension',
        strategy: 'serial',
        activities: ['plan-comprehension'],
      },
      { name: 'second-plan', strategy: 'serial', activities: ['plan'] },
      {
        name: 'readiness',
        strategy: 'serial',
        activities: ['plan-readiness'],
      },
      { name: 'deliver', strategy: 'serial', activities: ['build'] },
    ]

    // when
    const actual = await runWorkflow(
      fixture.args,
      stages,
      fixture.ports,
      () => ({ provider: 'fixture', modelId: 'model' }),
      async () => false,
    )

    // then
    expect(actual).toBe(EXIT.SUCCESS)
    expect(fixture.calls()).toEqual([
      'plan',
      'plan-comprehension',
      'plan',
      'plan-comprehension',
      'plan',
      'plan-readiness',
      'plan',
      'plan-readiness',
      'build',
    ])
    expect(fixture.builtFrom()?.summary).toBe('plan v4')
    expect(fixture.rounds('disputes-plan.json')).toMatchObject([
      { round: 1, reviewers: { 'plan-comprehension': ['name the files'] } },
      { round: 2, changed: 1, reviewers: { 'plan-comprehension': [] } },
    ])
    expect(fixture.rounds('disputes-plan_2.json')).toMatchObject([
      { round: 1, reviewers: { 'plan-readiness': ['name the files'] } },
      { round: 2, changed: 1, reviewers: { 'plan-readiness': [] } },
    ])
  },
)

for (const { approvesCode, expected } of [
  { approvesCode: true, expected: EXIT.SUCCESS },
  { approvesCode: false, expected: EXIT.FAILED },
]) {
  test(
    [
      'given issue #105 plan and code review with different revision ceilings',
      `when plan spends its only revision and code review ${approvesCode ? 'approves its last' : 'exhausts its two'}`,
      'it should preserve each budget, ledger, and the final code-review verdict',
    ].join(', '),
    async () => {
      // given — 1.5.1–1.5.3 keep plan's spent allowance out of test's two rounds.
      const ordinary = response((attempt, name) =>
        name === 'code-review' ? approvesCode && attempt > 2 : attempt > 1,
      )
      using fixture = fixtureWith(
        (name, attempt) =>
          name === 'test'
            ? buildOutputSchema.parse({
                ...CONTEXT,
                changed_files: ['src/work.test.ts'],
              })
            : ordinary(name, attempt),
        1,
      )
      const stages: readonly TStage[] = [
        ...STAGES.slice(0, 2),
        { name: 'deliver', strategy: 'serial', activities: ['build', 'test'] },
        { name: 'accept', strategy: 'serial', activities: ['code-review'] },
      ]

      // when
      const actual = await runWorkflow(
        fixture.args,
        stages,
        fixture.ports,
        () => ({ provider: 'fixture', modelId: 'model' }),
        async () => false,
      )

      // then
      expect(actual).toBe(expected)
      expect(fixture.calls()).toEqual([
        'plan',
        'plan-comprehension',
        'plan-readiness',
        'plan',
        'plan-comprehension',
        'plan-readiness',
        'build',
        'test',
        'code-review',
        'test',
        'code-review',
        'test',
        'code-review',
      ])
      expect(fixture.rounds('disputes-plan.json')).toMatchObject([
        { round: 1, blocking: ['name the files'] },
        { round: 2, blocking: [], changed: 1 },
      ])
      expect(fixture.rounds('disputes.json')).toMatchObject([
        { round: 1, blocking: ['name the files'] },
        { round: 2, blocking: ['name the files'] },
        { round: 3, blocking: approvesCode ? [] : ['name the files'] },
      ])
    },
  )
}

for (const { name: evidenceKind, evidence } of [
  { name: 'a plan line', evidence: 'plan.md:12 names the affected files' },
  { name: 'a command result', evidence: 'bun run check exited 0' },
]) {
  test(
    [
      'given issue #105 plan findings answered without rewriting the plan',
      `when the planner disputes them with ${evidenceKind} and both reviewers withdraw them`,
      'it should accept the dispute-only revision and hand it to build',
    ].join(', '),
    async () => {
      // given — 1.2.4 and 1.3 allow PlanOutput, including defaulted changed_files.
      const dispute = {
        finding: 'name the files',
        evidence,
        reason: 'the existing file list answers the finding',
      }
      const ordinary = response((attempt) => attempt > 1)
      using fixture = fixtureWith((name, attempt) =>
        name === 'plan' && attempt > 1
          ? planOutputSchema.parse({
              ...CONTEXT,
              summary: 'the plan stands with evidence',
              disputes: [dispute],
            })
          : ordinary(name, attempt),
      )

      // when
      const actual = await runWorkflow(
        fixture.args,
        STAGES.slice(0, 2).concat({
          name: 'deliver',
          strategy: 'serial',
          activities: ['build'],
        }),
        fixture.ports,
        () => ({ provider: 'fixture', modelId: 'model' }),
        async () => false,
      )

      // then
      expect(actual).toBe(EXIT.SUCCESS)
      expect(fixture.calls()).toEqual([
        'plan',
        'plan-comprehension',
        'plan-readiness',
        'plan',
        'plan-comprehension',
        'plan-readiness',
        'build',
      ])
      const approved = planOutputSchema.parse(fixture.builtFrom())
      expect(approved.summary).toBe('the plan stands with evidence')
      expect(approved.changed_files).toEqual([])
      expect(approved.disputes).toEqual([dispute])
      expect(fixture.rounds('disputes-plan.json')).toMatchObject([
        { round: 1, blocking: ['name the files'] },
        { round: 2, blocking: [], changed: 0 },
      ])
    },
  )
}

for (const changedFiles of [[], ['handoff/plan.md']]) {
  test(
    [
      'given issue #105 plan findings answered with an unsupported dispute',
      `when the planner claims ${changedFiles.length === 0 ? 'no rewrite' : 'a rewrite'} but cites only prose`,
      'it should fail the dispute gate before re-review or downstream work',
    ].join(', '),
    async () => {
      // given — 1.3.4 preserves the code-review evidence rule for plan disputes.
      const ordinary = response((attempt) => attempt > 1)
      using fixture = fixtureWith((name, attempt) =>
        name === 'plan' && attempt > 1
          ? planOutputSchema.parse({
              ...CONTEXT,
              changed_files: changedFiles,
              disputes: [
                {
                  finding: 'name the files',
                  evidence: 'The plan already says this',
                },
              ],
            })
          : ordinary(name, attempt),
      )

      // when, then
      await expect(
        runWorkflow(
          fixture.args,
          STAGES,
          fixture.ports,
          () => ({ provider: 'fixture', modelId: 'model' }),
          async () => false,
        ),
      ).rejects.toThrow('without one it is a refusal')
      expect(fixture.calls()).toEqual([
        'plan',
        'plan-comprehension',
        'plan-readiness',
        'plan',
        'plan',
        'plan',
      ])
    },
  )
}
