import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { main as answerRun } from '../../../../decide'
import {
  activityRunParams,
  contextEnvelopeSchema,
  EXIT,
} from '../../../../lib/contracts'
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
import { finish, finishWaiting } from './run-activity-run'
import { runTerminal } from './run-terminal'

for (const names of [['build'], ['verify', 'build']]) {
  test(
    [
      `given #117 AC1/AC4: a failed question in the last Activity of ${names.join(' -> ')}`,
      'when answer --file is followed by --resume',
      'it should rerun unfinished work with the human fact, retain completed work, and allow delivery',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture({ attempts: 1 })
      const { run } = fixture
      const known = {
        fact: 'The retention policy is configurable',
        evidence: 'src/retention.ts:12',
      }
      let replacedAtRestart: string | undefined
      const { ports, requests } = portsFor((model, attempt) => {
        if (model === 'fixture/build' && attempt === 1) {
          return work({
            status: 'fail',
            facts: [known],
            unresolved: [QUESTION],
          })
        }
        if (model === 'fixture/build') {
          replacedAtRestart = run.tracer
            .activityRunsFor(run.runId)
            .find((one) => one.params.name === 'build')?.status
        }
        return work({ facts: [known] })
      })
      let waiting: TWaiting | undefined
      await runActivities({
        run,
        activities: runnableActivities(names, run.cfg, {}, ports),
        start: contextFor(run),
        onWaiting: (stopped) => {
          waiting = stopped
        },
      })
      expect(waiting?.reason).toEqual({
        kind: 'escalated',
        activity: 'build',
        questions: [QUESTION.question],
      })
      expect(finishWaiting(run, waiting?.path ?? '')).toBe(EXIT.WAITING)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('waiting')
      expect(run.tracer.activityRunsFor(run.runId).at(-1)?.status).toBe(
        'waiting',
      )
      expect(
        readFileSync(decisionPath(run.contextHandoffDir), 'utf8'),
      ).toContain(QUESTION.question)
      const answer = 'The authorised retention window is 90 days.'
      const file = join(fixture.dir, 'answers.md')
      writeFileSync(file, `\n${answer}\n\n`)
      const config = fixture.configPath()
      let delivered = false
      const terminal: TTerminalActivity = {
        name: 'gh-pull-request',
        requires: [],
        requiresCommitting: true,
        params: activityRunParams({
          name: 'gh-pull-request',
          kind: 'agent',
          owner: 'gh-pull-request',
          description: 'Deliver the answered work',
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
      const recorded = await answerRun([
        'answer',
        run.runId,
        '--file',
        file,
        '--config',
        config,
        '--db',
        run.tracer.dbPath,
      ])
      const resumed = fixture.resume()
      const ctx = await runActivities({
        run: resumed,
        activities: runnableActivities(names, resumed.cfg, {}, ports),
        start: { ...contextFor(resumed), ...replayEnvelopeHistory(resumed) },
      })
      await runTerminal({
        run: resumed,
        activity: terminal,
        ctx,
        accepted: ctx.outcomes.every((one) => one.accepted),
      })
      const exit = finish(resumed)

      // then
      expect(recorded).toBe(EXIT.SUCCESS)
      expect(readFileSync(answerPath(run.contextHandoffDir), 'utf8')).toBe(
        `${answer}\n`,
      )
      expect(resumed.resume.has('build')).toBe(false)
      expect(resumed.resume.has('verify')).toBe(names.includes('verify'))
      expect(requests().map((one) => one.model)).toEqual([
        ...names.map((name) => `fixture/${name}`),
        'fixture/build',
      ])
      expect(replacedAtRestart).toBe('superseded')
      const variables = JSON.parse(requests().at(-1)?.prompt ?? '{}')
      const input = contextEnvelopeSchema.parse(
        JSON.parse(variables.previous_envelope ?? '{}'),
      )
      expect(input.facts).toEqual([
        known,
        {
          fact: answer,
          evidence: `answered by ${resumed.engineer} in ${answerPath(resumed.contextHandoffDir)}`,
        },
      ])
      expect(
        run.tracer.activityRunsFor(run.runId).map((one) => one.status),
      ).toEqual([
        ...(names.includes('verify') ? ['success' as const] : []),
        'superseded',
        'success',
        'success',
      ])
      expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([
        expect.objectContaining({ kind: 'escalated' }),
      ])
      expect(delivered).toBe(true)
      expect(exit).toBe(EXIT.SUCCESS)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('success')
    },
  )
}

for (const trust of [90, 100]) {
  test(
    [
      `given #117 AC1/AC5: a failed external-action question with a provisional answer at trust ${trust}`,
      'when the agent reports it before a successor',
      trust === 100
        ? 'it should fail with the original error, without opening a human gate'
        : 'it should wait even though the agent offered a defensible answer',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture({ trust })
      const { run } = fixture
      const external = {
        ...QUESTION,
        question: 'May I publish the policy?',
        beyond_this_run: true,
        provisional_answer: 'Publish the approved policy',
      }
      const { ports, requests } = portsFor(() =>
        work({
          status: 'fail',
          summary: 'Publishing needs permission',
          unresolved: [external],
        }),
      )
      let waiting: TWaiting | undefined
      const execute = () =>
        runActivities({
          run,
          activities: runnableActivities(
            ['build', 'verify'],
            run.cfg,
            {},
            ports,
          ),
          start: contextFor(run),
          onWaiting: (stopped) => {
            waiting = stopped
          },
        })

      // when, then
      if (trust === 100) {
        await expect(execute()).rejects.toThrow(
          "build reported status='fail': Publishing needs permission",
        )
        expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('fail')
        expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([])
        expect(existsSync(decisionPath(run.contextHandoffDir))).toBe(false)
      } else {
        await execute()
        expect(waiting?.reason).toEqual({
          kind: 'escalated',
          activity: 'build',
          questions: [external.question],
        })
        expect(finishWaiting(run, waiting?.path ?? '')).toBe(EXIT.WAITING)
        expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe(
          'waiting',
        )
        expect(run.tracer.activityRunsFor(run.runId).at(-1)?.status).toBe(
          'waiting',
        )
      }
      expect(requests().map((one) => one.model)).toEqual(['fixture/build'])
    },
  )
}

test(
  [
    'given #117 AC4: completed work waiting only for requested approval',
    'when it is approved and resumed with the same approval flag',
    'it should replay the approved work rather than mark it unfinished or ask again',
  ].join(', '),
  async () => {
    // given
    using fixture = gateFixture()
    const { run } = fixture
    const { ports, requests } = portsFor(() => work())
    let waiting: TWaiting | undefined
    await runActivities({
      run,
      activities: runnableActivities(['build', 'verify'], run.cfg, {}, ports),
      start: contextFor(run),
      approveAfter: ['build'],
      onWaiting: (stopped) => {
        waiting = stopped
      },
    })
    expect(waiting?.reason).toEqual({ kind: 'requested', activity: 'build' })
    finishWaiting(run, waiting?.path ?? '')

    // when
    const recorded = await answerRun([
      'approve',
      run.runId,
      '--config',
      fixture.configPath(),
      '--db',
      run.tracer.dbPath,
    ])
    const resumed = fixture.resume()
    let gatedAgain = false
    await runActivities({
      run: resumed,
      activities: runnableActivities(
        ['build', 'verify'],
        resumed.cfg,
        {},
        ports,
      ),
      start: { ...contextFor(resumed), ...replayEnvelopeHistory(resumed) },
      approveAfter: ['build'],
      onWaiting: () => {
        gatedAgain = true
      },
    })
    const exit = finish(resumed)

    // then
    expect(recorded).toBe(EXIT.SUCCESS)
    expect(resumed.resume.has('build')).toBe(true)
    expect(requests().map((one) => one.model)).toEqual([
      'fixture/build',
      'fixture/verify',
    ])
    expect(
      run.tracer.activityRunsFor(run.runId).map((one) => one.status),
    ).toEqual(['success', 'success'])
    expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([
      expect.objectContaining({ kind: 'requested' }),
    ])
    expect(gatedAgain).toBe(false)
    expect(exit).toBe(EXIT.SUCCESS)
  },
)

test(
  [
    'given #117 AC2/AC4: an answered waiting stage that encounters a different failure',
    'when the stage reruns without a blocking question',
    'it should supersede the waiting attempt but still fail with the new error',
  ].join(', '),
  async () => {
    // given
    using fixture = gateFixture()
    const { run } = fixture
    const { ports, requests } = portsFor((_model, attempt) =>
      attempt === 1
        ? work({ status: 'fail', unresolved: [QUESTION] })
        : work({ status: 'fail', summary: 'The retention check failed' }),
    )
    let waiting: TWaiting | undefined
    await runActivities({
      run,
      activities: runnableActivities(['build', 'verify'], run.cfg, {}, ports),
      start: contextFor(run),
      onWaiting: (stopped) => {
        waiting = stopped
      },
    })
    expect(waiting?.reason.kind).toBe('escalated')
    finishWaiting(run, waiting?.path ?? '')
    const file = join(fixture.dir, 'answers.md')
    writeFileSync(file, 'Use the 90-day window.\n')
    await answerRun([
      'answer',
      run.runId,
      '--file',
      file,
      '--config',
      fixture.configPath(),
      '--db',
      run.tracer.dbPath,
    ])
    const resumed = fixture.resume()

    // when, then
    await expect(
      runActivities({
        run: resumed,
        activities: runnableActivities(
          ['build', 'verify'],
          resumed.cfg,
          {},
          ports,
        ),
        start: { ...contextFor(resumed), ...replayEnvelopeHistory(resumed) },
      }),
    ).rejects.toThrow(
      "build reported status='fail': The retention check failed",
    )
    expect(requests().map((one) => one.model)).toEqual([
      'fixture/build',
      'fixture/build',
    ])
    expect(
      run.tracer.activityRunsFor(run.runId).map((one) => one.status),
    ).toEqual(['superseded', 'fail'])
    expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe('fail')
    expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toHaveLength(1)
  },
)
