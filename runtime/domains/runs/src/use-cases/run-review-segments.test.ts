import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TEnvelopeBase,
  TRun,
  TStage,
} from '../../../../lib/contracts'
import {
  buildOutputSchema,
  crustConfigSchema,
  planOutputSchema,
  reviewOutputSchema,
} from '../../../../lib/contracts'
import { runWithTracer } from '../../../../testing/fake-activity'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import type { TAgentPorts } from '../../../activities'
import { runnableActivities } from '../../../activities'
import { emptyUsage } from '../../../agents'
import { readLedger, roundRecord, writeLedger } from '../../../gates'
import { asSingleStage, unitsFrom } from '../../../planning'
import type { TAttemptLedger } from './attempts'
import { attemptLedger } from './attempts'
import { reviseActivity } from './revise-loop'
import type { TWaiting } from './run-activities'
import { reviewBoundaries, runReviewSegments } from './run-review-segments'

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

const plan = (attempt: number, disputed = false) =>
  planOutputSchema.parse({
    ...CONTEXT,
    summary: `plan v${attempt}`,
    changed_files: disputed ? [] : ['handoff/plan.md'],
    disputes: disputed
      ? [{ finding: 'name the files', evidence: 'plan.md:12' }]
      : [],
  })

const work = (summary: string) =>
  buildOutputSchema.parse({
    ...CONTEXT,
    summary,
    changed_files: ['src/work.ts'],
  })

const verdict = (approved: boolean, finding = 'name the files') =>
  reviewOutputSchema.parse({
    ...CONTEXT,
    approved,
    findings: approved
      ? []
      : [
          {
            requirement: finding,
            met: false,
            severity: 'major',
            evidence: 'plan.md:10',
          },
        ],
    blocking: approved ? [] : [finding],
  })

const fixtureWith = (
  response: (name: string, attempt: number) => TEnvelopeBase,
) => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-review-segments-'))
  const entries = [
    { name: 'plan', output: 'planOutput', attempts: 3 },
    { name: 'plan-comprehension', output: 'reviewOutput' },
    { name: 'plan-readiness', output: 'reviewOutput' },
    { name: 'build', output: 'buildOutput' },
    { name: 'test', output: 'buildOutput' },
    { name: 'code-review', output: 'reviewOutput' },
    { name: 'brief', output: 'genericOutput' },
  ].map((entry) => ({
    ...entry,
    model: `fixture/${entry.name}`,
    purpose: `Exercise ${entry.name} against the preceding work`,
    prompt_engineering: {
      system: `${entry.name}/system`,
      user: `${entry.name}/user`,
    },
    writes: [],
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
  const attempts = new Map<string, number>()
  let calls: readonly string[] = []
  let prompts: readonly string[] = []
  let renders: readonly Readonly<{
    path: string
    variables: Readonly<Record<string, string>>
  }>[] = []
  const ports: TAgentPorts = {
    run: (request) => {
      const name = request.model.slice('fixture/'.length)
      const attempt = (attempts.get(name) ?? 0) + 1
      attempts.set(name, attempt)
      calls = [...calls, name]
      prompts = [...prompts, request.prompt]
      return Promise.resolve({
        text: JSON.stringify(response(name, attempt)),
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
    render: (path, variables) => {
      renders = [...renders, { path, variables }]
      return path
    },
    savePrompt: (directory, name) => join(directory, name),
    snapshot: () => ({}),
    rev: () => '',
    content: () => ({ status: 'ok', data: {} }),
  }
  silenceTerminal()
  return {
    run,
    ports,
    calls: () => calls,
    prompts: () => prompts,
    renders: () => renders,
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

const execute = (
  fixture: ReturnType<typeof fixtureWith>,
  names: readonly string[],
  params: Readonly<{
    stages?: readonly TStage[]
    ledger?: TAttemptLedger
    onWaiting?: (waiting: TWaiting) => void
  }> = {},
) =>
  runReviewSegments({
    run: fixture.run,
    names,
    units: unitsFrom(
      params.stages ?? asSingleStage(names),
      runnableActivities(
        names,
        fixture.run.cfg,
        { committing: false },
        fixture.ports,
      ),
    ),
    start: contextFor(fixture.run),
    options: { committing: false },
    fallbackReason: 'not accepted',
    agentPorts: fixture.ports,
    ...(params.ledger === undefined ? {} : { ledger: params.ledger }),
    ...(params.onWaiting === undefined ? {} : { onWaiting: params.onWaiting }),
  })

test(
  [
    'given plan and code review groups in one chain',
    'when each rejects once and then approves',
    'it should settle each before later work, hand build the revised plan, and spend separate budgets',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name, attempt) => {
      if (name === 'plan') return plan(attempt)
      if (name === 'build' || name === 'test')
        return work(`${name} v${attempt}`)
      return verdict(attempt > 1, `${name} finding`)
    })
    const names = [
      'plan',
      'plan-comprehension',
      'plan-readiness',
      'build',
      'test',
      'code-review',
    ]
    const ledger = attemptLedger()
    const stages: readonly TStage[] = [
      { name: 'discover', strategy: 'serial', activities: ['plan'] },
      {
        name: 'review-plan',
        strategy: 'concurrent',
        activities: ['plan-comprehension', 'plan-readiness'],
      },
      { name: 'deliver', strategy: 'serial', activities: ['build', 'test'] },
      { name: 'accept', strategy: 'serial', activities: ['code-review'] },
    ]

    // when
    const actual = await execute(fixture, names, { stages, ledger })

    // then
    expect(actual.accepted).toBe(true)
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
    ])
    expect(ledger.spent('revise-plan')).toBe(1)
    expect(ledger.spent('revise')).toBe(1)
    expect(ledger.causes('revise-plan')).toEqual([
      'revise round 1 after a review that did not approve',
    ])
    const builtFrom = fixture.renders().find((one) => one.path === 'build/user')
      ?.variables.previous_envelope
    expect(JSON.parse(builtFrom ?? '{}').summary).toBe('plan v2')
    expect(fixture.prompts()[3]).toContain('plan-comprehension finding')
    expect(fixture.prompts()[3]).toContain('plan-readiness finding')
    expect(readLedger(fixture.run, 'revise-plan')[1]?.changed).toBe(1)
    expect(readLedger(fixture.run)[1]?.changed).toBe(1)
  },
)

test(
  [
    'given a plan review that never approves a rewritten plan',
    'when its three revision attempts are spent',
    'it should stop before build and report every reviewer in every round',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name, attempt) =>
      name === 'plan' ? plan(attempt) : verdict(name === 'plan-comprehension'),
    )
    const ledger = attemptLedger()

    // when
    const actual = await execute(
      fixture,
      ['plan', 'plan-comprehension', 'plan-readiness', 'build'],
      { ledger },
    )

    // then
    expect(actual.outcome).toBe('exhausted')
    expect(actual.accepted).toBe(false)
    expect(ledger.spent('revise-plan')).toBe(3)
    expect(fixture.calls().filter((name) => name === 'plan')).toHaveLength(4)
    expect(fixture.calls()).not.toContain('build')
    const path = join(fixture.run.contextHandoffDir, 'disputes-plan.md')
    expect(actual.reason).toContain(path)
    const report = readFileSync(path, 'utf8')
    expect(report).toContain('## Round 4 reviewers')
    expect(report).toContain('- plan-comprehension: (nothing blocking)')
    expect(report).toContain('- plan-readiness: name the files')
  },
)

test(
  [
    'given the same disputed plan finding and the same evidence on both sides',
    'when the reviewer repeats it after two identical disputes',
    'it should deadlock before build without spending the remaining attempt',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name, attempt) =>
      name === 'plan' ? plan(attempt, true) : verdict(false),
    )
    const ledger = attemptLedger()

    // when
    const actual = await execute(fixture, ['plan', 'plan-readiness', 'build'], {
      ledger,
    })

    // then
    expect(actual.outcome).toBe('deadlocked')
    expect(actual.accepted).toBe(false)
    expect(fixture.calls()).not.toContain('build')
    expect(ledger.remaining('revise-plan', 3)).toBe(1)
    expect(actual.reason).toContain('disputes-plan.md')
  },
)

test(
  [
    'given a plan revise that asks a person a question only they can answer',
    'when the plan review segment settles',
    'it should wait before build and record the unreached work as blocked',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name, attempt) =>
      name === 'plan'
        ? planOutputSchema.parse({
            ...plan(attempt),
            ...(attempt > 1
              ? {
                  status: 'fail',
                  unresolved: [
                    {
                      question: 'Which retention window is authorised?',
                      consequential: true,
                      beyond_this_run: false,
                      provisional_answer: '',
                    },
                  ],
                }
              : {}),
          })
        : verdict(false),
    )
    let waiting: TWaiting | undefined

    // when
    await execute(fixture, ['plan', 'plan-readiness', 'build'], {
      onWaiting: (stopped) => {
        waiting = stopped
      },
    })

    // then
    expect(waiting?.reason.kind).toBe('escalated')
    expect(fixture.calls()).toEqual(['plan', 'plan-readiness', 'plan'])
    expect(
      fixture.run.tracer.eventsNamed(fixture.run.runId, 'activities_blocked'),
    ).toEqual([expect.objectContaining({ activities: ['build'] })])
    expect(
      fixture.run.tracer.eventsNamed(fixture.run.runId, 'activities_cancelled'),
    ).toEqual([])
  },
)

test(
  [
    'given persisted plan rounds beside a different code-review ledger',
    'when a resumed conversation repeats the plan dispute',
    'it should detect the plan repeat without reading or overwriting the code conversation',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name, attempt) =>
      name === 'plan' ? plan(attempt, true) : verdict(false),
    )
    const previous = roundRecord({
      round: 2,
      reviews: [verdict(false)],
      reviewers: ['plan-readiness'],
      revise: plan(2, true),
    })
    const code = roundRecord({
      round: 8,
      reviews: [verdict(false, 'code finding')],
      revise: undefined,
    })
    writeLedger(fixture.run, [previous], 'revise-plan')
    writeLedger(fixture.run, [code])

    // when
    const actual = await execute(fixture, ['plan', 'plan-readiness', 'build'])

    // then
    expect(actual.outcome).toBe('deadlocked')
    expect(fixture.calls().filter((name) => name === 'plan')).toHaveLength(2)
    expect(readLedger(fixture.run, 'revise-plan')[0]).toEqual(previous)
    expect(
      readLedger(fixture.run, 'revise-plan').map((one) => one.round),
    ).toEqual([2, 3])
    expect(readLedger(fixture.run)).toEqual([code])
  },
)

test(
  [
    'given a revised plan with defaulted empty revision fields',
    'when it neither rewrites a file nor disputes a finding',
    'it should fail the disputesSupported gate without re-asking reviewers or building',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name) =>
      name === 'plan' ? planOutputSchema.parse(CONTEXT) : verdict(false),
    )

    // when, then
    await expect(
      execute(fixture, ['plan', 'plan-readiness', 'build']),
    ).rejects.toThrow('review answered')
    expect(fixture.calls().filter((name) => name === 'plan')).toHaveLength(4)
    expect(
      fixture.calls().filter((name) => name === 'plan-readiness'),
    ).toHaveLength(1)
    expect(fixture.calls()).not.toContain('build')
  },
)

test(
  [
    'given build after an approved plan-review segment',
    'when build requests a regression to plan',
    'it should retain the whole-chain regression scope and rejudge the new plan before rebuilding',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name, attempt) => {
      if (name === 'plan') return plan(attempt)
      if (name === 'build')
        return {
          ...work(`build v${attempt}`),
          regress_to:
            attempt === 1
              ? {
                  activity: 'plan',
                  because: 'the measured boundary requires a different plan',
                }
              : { activity: '', because: '' },
        }
      return verdict(true)
    })

    // when
    const actual = await execute(fixture, ['plan', 'plan-readiness', 'build'])

    // then
    expect(actual.accepted).toBe(true)
    expect(fixture.calls()).toEqual([
      'plan',
      'plan-readiness',
      'build',
      'plan',
      'plan-readiness',
      'build',
    ])
    const builds = fixture.renders().filter((one) => one.path === 'build/user')
    expect(
      builds.map(
        (one) => JSON.parse(one.variables.previous_envelope ?? '{}').summary,
      ),
    ).toEqual(['plan v1', 'plan v2'])
  },
)

test(
  [
    'given a leading reviewer and a configured builder elsewhere in the registry',
    'when the group has no preceding writer',
    'it should be not-applicable and name the group without falling back to build',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith(() => verdict(false))

    // when
    const actual = await execute(fixture, ['plan-readiness'])

    // then
    expect(actual.outcome).toBe('not-applicable')
    expect(actual.accepted).toBe(false)
    expect(fixture.calls()).toEqual(['plan-readiness'])
    expect(terminalOutput()).toContain(
      'review group [plan-readiness] is not applicable: no preceding writer',
    )
  },
)

test(
  [
    'given a writer whose envelope has no revision fields',
    'when the following group rejects it',
    'it should be not-applicable and name the writer and both missing fields',
  ].join(', '),
  async () => {
    // given
    using fixture = fixtureWith((name) =>
      name === 'brief'
        ? {
            status: 'success',
            summary: '',
            artifacts: [],
            notes_for_next_agent: '',
          }
        : verdict(false),
    )

    // when
    const actual = await execute(fixture, ['brief', 'plan-readiness'])

    // then
    expect(actual.outcome).toBe('not-applicable')
    expect(fixture.calls()).toEqual(['brief', 'plan-readiness'])
    expect(terminalOutput()).toContain(
      "'brief' lacks disputes and changed_files",
    )
    const brief = fixture.run.cfg.activities.find((one) => one.name === 'brief')
    if (brief === undefined) throw new Error('missing fixture writer')
    expect(() => reviseActivity(brief, {}, fixture.ports)).toThrow(
      'no revisable envelope contract',
    )
  },
)

test(
  [
    'given consecutive reviewers in separate Stages',
    'when the folded chain is partitioned at review boundaries',
    'it should end the segment after the last reviewer rather than after the first Stage',
  ].join(', '),
  () => {
    // given
    using fixture = fixtureWith(() => verdict(true))
    const names = ['plan', 'plan-comprehension', 'plan-readiness', 'build']
    const activities = runnableActivities(
      names,
      fixture.run.cfg,
      {},
      fixture.ports,
    )
    const stages: readonly TStage[] = names.map((name) => ({
      name,
      strategy: 'serial',
      activities: [name],
    }))

    // when
    const actual = reviewBoundaries(
      unitsFrom(stages, activities),
      names,
      fixture.run.cfg,
    )

    // then
    expect(actual).toEqual([
      {
        through: 2,
        group: { at: 1, members: ['plan-comprehension', 'plan-readiness'] },
      },
    ])
  },
)
