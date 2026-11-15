import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { activityRunParams, EXIT } from '../../../../lib/contracts'
import type { TTerminalActivity } from '../../../activities'
import { runnableActivities } from '../../../activities'
import { readRunState } from '../../../trace'
import { answerPath, decisionPath } from './human-gate'
import {
  contextFor,
  gateFixture,
  portsFor,
  QUESTION,
  work,
} from './human-gate-fixture.test'
import { replayEnvelopeHistory } from './replay-envelope-history'
import type { TWaiting } from './run-activities'
import { runActivities } from './run-activities'
import { counts, finish, finishWaiting } from './run-activity-run'
import { runTerminal } from './run-terminal'

for (const status of ['success', 'fail'] as const) {
  test(
    [
      `given a ${status} envelope with a blocking question`,
      'when runActivities reaches it before a successor',
      'it should wait before checking unfinished work and leave the asking row waiting',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      const { ports, requests } = portsFor(() =>
        work({ status, unresolved: [QUESTION] }),
      )
      const activities = runnableActivities(
        ['build', 'verify'],
        run.cfg,
        {},
        ports,
      ).map((activity) => ({
        ...activity,
        gates: [
          {
            name: 'unfinished-work',
            check: () => {
              throw new Error('Unfinished work must wait before checks run')
            },
          },
        ],
      }))
      let waiting: TWaiting | undefined

      // when
      await runActivities({
        run,
        activities,
        start: contextFor(run),
        onWaiting: (stopped) => {
          waiting = stopped
        },
      })
      const exit =
        waiting === undefined ? finish(run) : finishWaiting(run, waiting.path)

      // then
      expect(exit).toBe(EXIT.WAITING)
      expect(requests().map((one) => one.model)).toEqual(['fixture/build'])
      expect(waiting?.reason).toEqual({
        kind: 'escalated',
        activity: 'build',
        questions: [QUESTION.question],
      })
      expect(
        readFileSync(decisionPath(run.contextHandoffDir), 'utf8'),
      ).toContain(QUESTION.question)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('waiting')
      expect(
        run.tracer.activityRunsFor(run.runId).map((one) => one.status),
      ).toEqual(['waiting'])
      expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([
        expect.objectContaining({ kind: 'escalated' }),
      ])
    },
  )
}

for (const given of [
  { name: 'no question', trust: 50, unresolved: [] },
  {
    name: 'a defensible reversible answer',
    trust: 50,
    unresolved: [{ ...QUESTION, provisional_answer: '90 days' }],
  },
  { name: 'a question at total trust', trust: 100, unresolved: [QUESTION] },
]) {
  test(
    [
      `given a failed envelope with ${given.name}`,
      'when runActivities executes the agent',
      'it should retain the original failure message rather than open a human gate',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture({ trust: given.trust })
      const { run } = fixture
      const { ports } = portsFor(() =>
        work({
          status: 'fail',
          summary: 'Could not finish',
          unresolved: given.unresolved,
        }),
      )

      // when, then
      await expect(
        runActivities({
          run,
          activities: runnableActivities(
            ['build', 'verify'],
            run.cfg,
            {},
            ports,
          ),
          start: contextFor(run),
          trust: run.trust,
        }),
      ).rejects.toThrow("build reported status='fail': Could not finish")
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('fail')
      expect(
        run.tracer.activityRunsFor(run.runId).map((one) => one.status),
      ).toEqual(['fail'])
      expect(existsSync(decisionPath(run.contextHandoffDir))).toBe(false)
      expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([])
    },
  )
}

for (const status of ['success', 'fail'] as const) {
  test(
    [
      `given a waiting ${status} envelope and a person's answer`,
      'when the session resumes',
      'it should rerun the asking stage with an attributed fact, supersede the waiting row, and reach delivery',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      let statusAtRestart: string | undefined
      const { ports, requests, renders } = portsFor((model, attempt) => {
        if (model === 'fixture/build' && attempt === 1) {
          return work({ status, unresolved: [QUESTION] })
        }
        if (model === 'fixture/build') {
          statusAtRestart = run.tracer.activityRunsFor(run.runId)[0]?.status
        }
        return work()
      })
      let waiting: TWaiting | undefined
      await runActivities({
        run,
        activities: runnableActivities(['build', 'verify'], run.cfg, {}, ports),
        start: contextFor(run),
        onWaiting: (stopped) => {
          waiting = stopped
        },
      })
      expect(waiting).toBeDefined()
      finishWaiting(run, waiting?.path ?? '')
      const answer = 'The authorised retention window is 90 days.'
      writeFileSync(answerPath(run.contextHandoffDir), answer)
      const resumed = fixture.resume()
      expect(resumed.resume.has('build')).toBe(false)
      const gatesBefore = run.tracer.eventsNamed(
        run.runId,
        'human_gate_open',
      ).length
      let delivered = false
      const terminal: TTerminalActivity = {
        name: 'gh-pull-request',
        requires: [],
        requiresCommitting: true,
        params: activityRunParams({
          name: 'gh-pull-request',
          kind: 'agent',
          owner: 'gh-pull-request',
          description: 'Deliver the accepted fixture work',
        }),
        deliver: () => {
          delivered = true
          return Promise.resolve({
            action: 'created',
            url: 'https://example.test/pr/117',
            reason: '',
            recoverable: false,
            fallback: false,
          })
        },
      }

      // when
      const ctx = await runActivities({
        run: resumed,
        activities: runnableActivities(
          ['build', 'verify'],
          resumed.cfg,
          {},
          ports,
        ),
        start: { ...contextFor(resumed), ...replayEnvelopeHistory(resumed) },
      })
      await runTerminal({
        run: resumed,
        activity: terminal,
        ctx,
        accepted: true,
      })
      const exit = finish(resumed)

      // then
      expect(requests().map((one) => one.model)).toEqual([
        'fixture/build',
        'fixture/build',
        'fixture/verify',
      ])
      expect(statusAtRestart).toBe('superseded')
      const input = JSON.parse(renders()[2]?.previous_envelope ?? '{}')
      expect(input.facts).toContainEqual({
        fact: answer,
        evidence: `answered by ${resumed.engineer} in ${answerPath(resumed.contextHandoffDir)}`,
      })
      expect(
        run.tracer.activityRunsFor(run.runId).map((one) => one.status),
      ).toEqual(['superseded', 'success', 'success', 'success'])
      expect(
        run.tracer
          .activityRunsFor(run.runId)
          .filter(counts)
          .some((one) => one.status !== 'success'),
      ).toBe(false)
      expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toHaveLength(
        gatesBefore,
      )
      expect(delivered).toBe(true)
      expect(exit).toBe(EXIT.SUCCESS)
    },
  )
}
