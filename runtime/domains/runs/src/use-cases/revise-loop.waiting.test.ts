import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../../../../lib/contracts'
import { REPORT_FILENAME, readLedger } from '../../../gates'
import { readRunState } from '../../../trace'
import { answerPath, decisionPath } from './human-gate'
import {
  contextFor,
  gateFixture,
  portsFor,
  QUESTION,
  review,
  work,
} from './human-gate-fixture.test'
import { runReviseLoop } from './revise-loop'
import type { TWaiting } from './run-activities'
import { runWorkflow } from './run-workflow'

/** A revise answers its review with a rewrite, as `disputesSupported` requires. */
const revised = (overrides: Readonly<Record<string, unknown>> = {}) =>
  work({ changed_files: ['src/retention.ts'], ...overrides })

for (const status of ['success', 'fail'] as const) {
  test(
    [
      `given a reviser reporting ${status} with a blocking question`,
      'when it runs as the only Activity in the nested fold',
      'it should wait for a person without re-asking reviewers or starting another round',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      const rejected = review()
      const { ports, requests } = portsFor((model) =>
        model === 'fixture/build'
          ? work({ status, unresolved: [QUESTION] })
          : review({ approved: true, blocking: [] }),
      )
      let waiting: TWaiting | undefined

      // when
      const actual = await runReviseLoop(run, {
        names: ['build', 'review'],
        options: {},
        ctx: {
          ...contextFor(run),
          previous: work(),
          upstream: [{ activity: 'review', envelope: rejected }],
          outcomes: [
            { activity: 'build', accepted: true },
            { activity: 'review', accepted: false },
          ],
        },
        fallbackReason: 'Not approved',
        agentPorts: ports,
        onWaiting: (stopped) => {
          waiting = stopped
        },
      })

      // then
      expect(actual.outcome).toBe('waiting')
      expect(actual.accepted).toBe(false)
      expect(waiting?.reason).toEqual({
        kind: 'escalated',
        activity: 'revise',
        questions: [QUESTION.question],
      })
      expect(requests().map((one) => one.model)).toEqual(['fixture/build'])
      expect(
        run.tracer.activityRunsFor(run.runId).map((one) => one.status),
      ).toEqual(['waiting'])
      expect(
        readFileSync(decisionPath(run.contextHandoffDir), 'utf8'),
      ).toContain(QUESTION.question)
      expect(readLedger(run)).toEqual([])
      expect(existsSync(join(run.contextHandoffDir, REPORT_FILENAME))).toBe(
        false,
      )
    },
  )
}

for (const activity of ['revise', 'review']) {
  test(
    [
      `given approval requested after ${activity} inside a revise loop`,
      'when that Activity completes',
      'it should propagate the requested gate and stop the loop without recording a completed round',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      const rejected = review()
      const { ports, requests } = portsFor((model) =>
        model === 'fixture/build'
          ? revised()
          : review({ approved: true, blocking: [] }),
      )
      let waiting: TWaiting | undefined

      // when
      const actual = await runReviseLoop(run, {
        names: ['build', 'review'],
        options: {},
        ctx: {
          ...contextFor(run),
          upstream: [{ activity: 'review', envelope: rejected }],
          outcomes: [{ activity: 'review', accepted: false }],
        },
        fallbackReason: 'Not approved',
        agentPorts: ports,
        approveAfter: [activity],
        onWaiting: (stopped) => {
          waiting = stopped
        },
      })

      // then
      expect(actual.outcome).toBe('waiting')
      expect(waiting?.reason).toEqual({ kind: 'requested', activity })
      expect(requests().map((one) => one.model)).toEqual(
        activity === 'revise'
          ? ['fixture/build']
          : ['fixture/build', 'fixture/review'],
      )
      expect(readLedger(run)).toEqual([])
    },
  )
}

test(
  [
    'given a re-asked reviewer that fails with a blocking question',
    'when the nested review fold reaches its gate',
    'it should propagate waiting without recording a completed round or revising again',
  ].join(', '),
  async () => {
    // given
    using fixture = gateFixture()
    const { run } = fixture
    const { ports, requests } = portsFor((model) =>
      model === 'fixture/build'
        ? revised()
        : review({ status: 'fail', unresolved: [QUESTION] }),
    )
    let waiting: TWaiting | undefined

    // when
    const actual = await runReviseLoop(run, {
      names: ['build', 'review'],
      options: {},
      ctx: {
        ...contextFor(run),
        upstream: [{ activity: 'review', envelope: review() }],
        outcomes: [{ activity: 'review', accepted: false }],
      },
      fallbackReason: 'Not approved',
      agentPorts: ports,
      onWaiting: (stopped) => {
        waiting = stopped
      },
    })

    // then
    expect(actual.outcome).toBe('waiting')
    expect(waiting?.reason).toEqual({
      kind: 'escalated',
      activity: 'review',
      questions: [QUESTION.question],
    })
    expect(requests().map((one) => one.model)).toEqual([
      'fixture/build',
      'fixture/review',
    ])
    expect(run.tracer.activityRunsFor(run.runId).at(-1)?.status).toBe('waiting')
    expect(readLedger(run)).toEqual([])
  },
)

test(
  [
    'given a successful reviser with questions at total trust',
    'when the loop re-asks its reviewer',
    'it should inherit the run trust level and continue without a human gate',
  ].join(', '),
  async () => {
    // given
    using fixture = gateFixture({ trust: 100 })
    const { run } = fixture
    const { ports, requests } = portsFor((model) =>
      model === 'fixture/build'
        ? revised({ unresolved: [QUESTION] })
        : review({ approved: true, blocking: [] }),
    )

    // when
    const actual = await runReviseLoop(run, {
      names: ['build', 'review'],
      options: {},
      ctx: {
        ...contextFor(run),
        upstream: [{ activity: 'review', envelope: review() }],
        outcomes: [{ activity: 'review', accepted: false }],
      },
      fallbackReason: 'Not approved',
      agentPorts: ports,
    })

    // then
    expect(actual.outcome).toBe('approved')
    expect(actual.accepted).toBe(true)
    expect(requests().map((one) => one.model)).toEqual([
      'fixture/build',
      'fixture/review',
    ])
    expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([])
  },
)

for (const trust of [50, 100]) {
  test(
    [
      `given a reviser with a failed question at trust ${trust}`,
      'when runWorkflow enters its revise loop',
      trust === 50
        ? 'it should settle waiting, then rerun the reviser with the answer on resume'
        : 'it should retain the failed run rather than gate at total trust',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture({ trust })
      const { run } = fixture
      const { ports, requests, renders } = portsFor((model, attempt) => {
        if (model === 'fixture/build') {
          return attempt === 2
            ? revised({
                status: 'fail',
                summary: 'Need the retention decision',
                unresolved: [QUESTION],
              })
            : revised()
        }
        return review({
          approved: attempt > 1,
          blocking: attempt > 1 ? [] : review().blocking,
        })
      })
      const args = {
        prompt: 'Implement the retention policy',
        config: fixture.configPath(),
        runId: run.runId,
        base: undefined,
        resume: false,
        activities: undefined,
        lifecycle: undefined,
        models: undefined,
        approveAfter: undefined,
        commit: 'false',
        stream: false,
        trustLevel: String(trust),
        handoff: undefined,
        name: undefined,
      }
      const plan = [
        {
          name: 'deliver',
          strategy: 'serial' as const,
          activities: ['build', 'review'],
        },
      ]
      const resolveModel = (pattern: string) => ({
        provider: 'fixture',
        modelId: pattern.slice('fixture/'.length),
      })
      const execute = (resume: boolean) =>
        runWorkflow(
          { ...args, resume },
          plan,
          ports,
          resolveModel,
          async () => false,
        )

      // when, then
      if (trust === 100) {
        await expect(execute(false)).rejects.toThrow(
          "build reported status='fail': Need the retention decision",
        )
        expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('fail')
        expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([])
        return
      }
      expect(await execute(false)).toBe(EXIT.WAITING)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('waiting')
      expect(requests().map((one) => one.model)).toEqual([
        'fixture/build',
        'fixture/review',
        'fixture/build',
      ])
      expect(run.tracer.activityRunsFor(run.runId).at(-1)?.status).toBe(
        'waiting',
      )
      const answer = 'Use the 90-day retention window.'
      writeFileSync(answerPath(run.contextHandoffDir), answer)
      expect(await execute(true)).toBe(EXIT.SUCCESS)
      expect(requests().map((one) => one.model)).toEqual([
        'fixture/build',
        'fixture/review',
        'fixture/build',
        'fixture/build',
        'fixture/review',
      ])
      const input = JSON.parse(renders()[6]?.previous_envelope ?? '{}')
      expect(input.facts).toContainEqual(
        expect.objectContaining({
          fact: answer,
          evidence: expect.stringContaining('answered by '),
        }),
      )
      expect(
        run.tracer
          .activityRunsFor(run.runId)
          .filter((one) => one.params.name === 'revise')
          .map((one) => one.status),
      ).toEqual(['superseded', 'success'])
      expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toHaveLength(
        1,
      )
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('success')
    },
  )
}
