/**
 * `runUnits` driven end to end with `fakeActivity`/`runWithTracer`
 * (COVERAGE-WORKFLOW-DRIVERS.md) — the human-gate and regression paths that
 * `run-units.test.ts`'s own ad hoc fakes do not reach. No agent is spawned
 * anywhere in this file.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeActivity, runWithTracer } from '../testing/fake-activity'
import { restoreTerminal, silenceTerminal } from '../testing/terminal-capture'
import { crustConfigSchema } from '../typedefs/config'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TActivityContext } from '../typedefs/runnable-activity'
import type { TUnit } from '../typedefs/unit'
import { runUnits } from './run-activities'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

const aRun = (): TRun => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-activities-driver-'))
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: join(dir, 'runtime') },
    observability: { db: join(dir, 'crust.db') },
    agents: [],
  })

  return runWithTracer(dir, cfg)
}

const contextEnvelope = (
  overrides: Readonly<Partial<Record<string, unknown>>> = {},
): TEnvelopeBase =>
  ({
    status: 'success',
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
    ...overrides,
  }) as unknown as TEnvelopeBase

const contextFor = (run: TRun): TActivityContext => ({
  run,
  prompt: 'x',
  previous: undefined,
  previousStep: undefined,
  upstream: [],
  cohort: [],
  baseline: '',
  outcomes: [],
  feedback: [],
})

const unit = (name: string, activities: TUnit['activities']): TUnit => ({
  stage: name,
  strategy: 'serial',
  activities,
  endsStage: true,
})

test(
  [
    'given use-cases/run-activities::runUnits (fakeActivity)',
    'when a fake Activity simply accepts',
    'it should carry its envelope forward with no agent ever spawned',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const activity = fakeActivity('build', [
      { kind: 'accepted', envelope: contextEnvelope({ summary: 'built it' }) },
    ])

    // when
    const actual = await runUnits({
      run,
      units: [unit('implement', [activity])],
      start: contextFor(run),
    })

    // then
    expect(actual.outcomes).toEqual([{ activity: 'build', accepted: true }])
    expect((actual.previous as Readonly<{ summary: string }>).summary).toEqual(
      'built it',
    )
  },
)

test(
  [
    'given use-cases/run-activities::runUnits (fakeActivity)',
    'when a stage leaves a consequential question nobody can answer at the default trust level',
    'it should raise a human gate, call onWaiting, and record why the run is waiting',
  ].join(', '),
  async () => {
    // given — a two-unit chain, so the question is not on the last stage and
    // the Authority Rule applies: a later stage would otherwise have to
    // invent the answer
    const run = aRun()
    const first = fakeActivity('plan', [
      {
        kind: 'accepted',
        envelope: contextEnvelope({
          unresolved: [
            {
              question: 'which database should this run against',
              consequential: true,
              beyond_this_run: false,
              provisional_answer: '',
            },
          ],
        }),
      },
    ])
    const second = fakeActivity('build', [
      { kind: 'accepted', envelope: contextEnvelope() },
    ])
    let waiting: Readonly<{ path: string }> | undefined

    // when
    const actual = await runUnits({
      run,
      units: [unit('design', [first]), unit('implement', [second])],
      start: contextFor(run),
      onWaiting: (stopped) => {
        waiting = stopped
      },
    })

    // then — the run stopped after 'plan' and never reached 'build'
    expect(actual.outcomes).toEqual([{ activity: 'plan', accepted: true }])
    expect(waiting).toBeDefined()
    const written = readFileSync(waiting?.path ?? '', 'utf8')
    expect(written).toContain('which database should this run against')
    const blocked = run.tracer
      .eventsNamed(run.runId, 'activities_blocked')
      .at(0) as Readonly<{ activities: readonly string[] }> | undefined
    expect(blocked?.activities).toEqual(['build'])
  },
)

test(
  [
    'given use-cases/run-activities::runUnits (fakeActivity)',
    'when a later stage asks to go back to an earlier one with new evidence',
    'it should re-run from the earlier stage and record the regression',
  ].join(', '),
  async () => {
    // given — 'review' asks to return to 'build' once; the second pass
    // through 'build' settles with no further regression
    const run = aRun()
    const build = fakeActivity('build', [
      {
        kind: 'accepted',
        envelope: contextEnvelope({ summary: 'first pass' }),
      },
      {
        kind: 'accepted',
        envelope: contextEnvelope({ summary: 'second pass' }),
      },
    ])
    const review = fakeActivity('review', [
      {
        kind: 'accepted',
        envelope: contextEnvelope({
          regress_to: { activity: 'build', because: 'the design cannot work' },
        }),
      },
      { kind: 'accepted', envelope: contextEnvelope({ summary: 'approved' }) },
    ])

    // when
    const actual = await runUnits({
      run,
      units: [unit('implement', [build]), unit('accept', [review])],
      start: contextFor(run),
    })

    // then — build ran twice, review ran twice, and the regression is traced
    expect(actual.outcomes.map((one) => one.activity)).toEqual([
      'build',
      'review',
      'build',
      'review',
    ])
    expect((actual.previous as Readonly<{ summary: string }>).summary).toEqual(
      'approved',
    )
    const regressed = run.tracer.eventsNamed(run.runId, 'regression').at(0) as
      | Readonly<{ from: string; to: string; because: string }>
      | undefined
    expect(regressed).toEqual({
      from: 'review',
      to: 'build',
      because: 'the design cannot work',
    })
  },
)

test(
  [
    'given use-cases/run-activities::runUnits (fakeActivity)',
    'when a stage asks to go back to an Activity this chain does not run',
    'it should refuse the regression and record why, rather than throw',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const build = fakeActivity('build', [
      {
        kind: 'accepted',
        envelope: contextEnvelope({
          regress_to: {
            activity: 'design',
            because: 'missing from this chain',
          },
        }),
      },
    ])

    // when
    const actual = await runUnits({
      run,
      units: [unit('implement', [build])],
      start: contextFor(run),
    })

    // then — the run did not throw; it recorded a refusal and moved on
    expect(actual.outcomes.at(-1)).toEqual({
      activity: 'build',
      accepted: false,
    })
    const refused = run.tracer
      .eventsNamed(run.runId, 'regression_refused')
      .at(0) as Readonly<{ reason: string }> | undefined
    expect(refused?.reason).toContain('this chain does not')
  },
)

test(
  [
    'given testing/fake-activity::fakeActivity',
    'when the first attempt violates and the second accepts',
    'it should spend a second Activity Run with the violation as feedback, then settle',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const activity = fakeActivity('build', [
      {
        kind: 'violates',
        envelope: contextEnvelope(),
        violations: ['suite: exit 1'],
      },
      {
        kind: 'accepted',
        envelope: contextEnvelope({ summary: 'green on the retry' }),
      },
    ])

    // when
    const actual = await runUnits({
      run,
      units: [unit('implement', [activity])],
      start: contextFor(run),
    })

    // then
    expect(actual.outcomes).toEqual([{ activity: 'build', accepted: true }])
    expect((actual.previous as Readonly<{ summary: string }>).summary).toEqual(
      'green on the retry',
    )
    expect(
      run.activityRuns().filter((one) => one.params.name === 'build'),
    ).toHaveLength(2)
  },
)

test(
  [
    'given testing/fake-activity::fakeActivity',
    'when an attempt throws',
    'it should reject the Unit with that error, exactly as a real Activity would',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const activity = fakeActivity('build', [
      { kind: 'throws', message: 'the fixture refused on purpose' },
    ])

    // when, then
    await expect(
      runUnits({
        run,
        units: [unit('implement', [activity])],
        start: contextFor(run),
      }),
    ).rejects.toThrow('the fixture refused on purpose')
  },
)

test(
  [
    'given testing/fake-activity::fakeActivity',
    'when replay is called directly, as `skipIfDone` does on a resumed Activity Run',
    'it should hand back the last accepted outcome with no further attempt spent',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const activity = fakeActivity('build', [
      {
        kind: 'accepted',
        envelope: contextEnvelope({ summary: 'already done' }),
      },
    ])
    await activity.execute(contextFor(run), {
      activityRun: {} as never,
      log: () => undefined,
    })

    // when
    const replayed = await activity.replay(contextFor(run))

    // then
    expect(replayed.accepted).toBe(true)
    expect(
      (replayed.previous as Readonly<{ summary: string }>).summary,
    ).toEqual('already done')
  },
)

test(
  [
    'given use-cases/run-activities::runActivities',
    'when it is given a flat list of Activities',
    'it should run them each as their own serial, stage-ending Unit',
  ].join(', '),
  async () => {
    // given
    const run = aRun()
    const { runActivities } = await import('./run-activities')
    const activity = fakeActivity('build', [
      {
        kind: 'accepted',
        envelope: contextEnvelope({ summary: 'via runActivities' }),
      },
    ])

    // when
    const actual = await runActivities({
      run,
      activities: [activity],
      start: contextFor(run),
    })

    // then
    expect(actual.outcomes).toEqual([{ activity: 'build', accepted: true }])
  },
)
