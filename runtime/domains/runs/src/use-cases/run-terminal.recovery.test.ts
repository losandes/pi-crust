import { expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activityRunParams, EXIT } from '../../../../lib/contracts'
import { observedPayload, PATHS_TOUCHED } from '../../../policy'
import { readRunState } from '../../../trace'
import {
  COMMIT_REFUSED_EVENT,
  commitActivity,
  outstandingCommits,
} from './deliver'
import { finish, finishWaiting, runActivityRun } from './run-activity-run'
import { runTerminal } from './run-terminal'
import {
  deliveryFixture,
  gitIn,
  refuseBuildCommit,
  terminalActivity,
  terminalContext,
} from './run-terminal-fixture.test'

for (const blocker of [
  { name: 'unaccepted work', accepted: false, failedReview: false },
  { name: 'a failed review', accepted: true, failedReview: true },
]) {
  test(
    [
      `given issue #125 requirements 1.1.9 and 1.5.3, refused work, and ${blocker.name}`,
      'when the operator removes the refusing hook but delivery is still cancelled',
      'it should not retry or commit the work before acceptance and successful counted Activities',
    ].join(', '),
    async () => {
      // given
      using fixture = deliveryFixture()
      const { run, dir } = fixture
      rmSync(await refuseBuildCommit(run))
      if (blocker.failedReview) {
        await expect(
          runActivityRun(run)(
            activityRunParams({
              name: 'review',
              kind: 'code',
              owner: 'review',
              description: 'Review the completed work',
            }),
            () => {
              throw new Error('review rejected the work')
            },
          ),
        ).rejects.toThrow('review rejected the work')
      }
      const head = gitIn(dir, 'rev-parse', 'HEAD')
      let deliveries = 0
      const activity = terminalActivity(() => {
        deliveries += 1
        return Promise.resolve({
          action: 'created',
          url: 'https://example.test/pull/125',
          reason: '',
          recoverable: false,
          fallback: false,
        })
      })

      // when
      const actual = await runTerminal({
        run,
        activity,
        ctx: terminalContext(run),
        accepted: blocker.accepted,
      })
      const state = readRunState(run.tracer.dbPath, run.runId)

      // then
      expect(actual).toEqual({ kind: 'settled' })
      expect(deliveries).toBe(0)
      expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(head)
      expect(gitIn(dir, 'diff', '--cached', '--name-only')).toBe('work.txt')
      expect(
        outstandingCommits(run).map((warning) => warning.activities),
      ).toEqual([['build']])
      expect(
        run.tracer.eventsNamed(run.runId, COMMIT_REFUSED_EVENT),
      ).toHaveLength(1)
      expect(
        run.tracer
          .eventsNamed(run.runId, 'tree_warning')
          .filter((warning) => warning.kind === 'recovered'),
      ).toEqual([])
      expect(state?.activityRuns.at(-1)?.status).toBe('cancelled')
      expect(state?.activityRuns.flatMap((row) => row.gates)).toEqual([])
    },
  )
}

for (const action of ['created', 'updated'] as const) {
  test(
    [
      `given issue #125 requirements 1.1.4–1.1.7 and a differently named terminal reporting ${action}`,
      'when its non-recoverable result has no usable pull-request URL',
      'it should persist the engine-owned gate failure and fail the whole run',
    ].join(', '),
    async () => {
      // given
      using fixture = deliveryFixture()
      const { run } = fixture
      await fixture.build()
      const activity = {
        ...terminalActivity(() =>
          Promise.resolve({
            action,
            url: action === 'created' ? '' : ' \n\t',
            reason: '',
            recoverable: false,
            fallback: false,
          }),
        ),
        name: 'publish-fixture',
        params: activityRunParams({
          name: 'publish-fixture',
          kind: 'agent',
          owner: 'publish-fixture',
          description: 'Deliver through a terminal with no declared gates',
        }),
      }

      // when
      const actual = await runTerminal({
        run,
        activity,
        ctx: terminalContext(run),
        accepted: true,
      })
      const exit = finish(run)
      const state = readRunState(run.tracer.dbPath, run.runId)

      // then
      expect(actual).toEqual({ kind: 'settled' })
      expect(exit).toBe(EXIT.FAILED)
      expect(state?.status).toBe('fail')
      expect(state?.activityRuns.at(-1)).toMatchObject({
        name: 'publish-fixture',
        status: 'fail',
        error: `failed its gates: pull request: ${action} reported no URL`,
        gates: [
          {
            gate: 'pull_request_opened',
            activityRun: 'publish-fixture',
            passed: false,
            violations: [`pull request: ${action} reported no URL`],
            checks: [
              {
                item: 'pull request',
                ok: false,
                note: `${action} reported no URL`,
              },
            ],
          },
        ],
      })
    },
  )
}

test(
  [
    'given issue #125 requirements 1.3.2 and 1.4.2 and two refused Activity commits',
    'when the first still refuses but the second can land, then the operator clears the remaining refusal',
    'it should retry both once, wait before delivery, and deliver the complete work on resume',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    const hook = await refuseBuildCommit(run)
    writeFileSync(join(dir, 'test.txt'), 'verification work\n')
    const testRunId = await runActivityRun(run)(
      activityRunParams({
        name: 'test',
        kind: 'agent',
        owner: 'test',
        description: 'Verify the completed change',
      }),
      (handle) => {
        run.tracer.event({
          run_id: run.runId,
          activity_run_id: handle.activityRun.activity_run_id,
          type: 'log',
          name: PATHS_TOUCHED,
          payload: observedPayload({
            activity: 'test',
            activityRunId: handle.activityRun.activity_run_id,
            agent: 'test',
            touched: ['test.txt'],
            dirtyBefore: ['work.txt'],
            claimed: ['test.txt'],
          }),
        })
        return handle.activityRun.activity_run_id
      },
    )
    commitActivity(run, 'test', testRunId, undefined, 'verify')
    writeFileSync(
      hook,
      [
        '#!/bin/sh',
        'if git diff --cached --name-only -- work.txt | grep -q .; then',
        '  echo "build still requires approval" >&2',
        '  exit 1',
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    )
    let deliveries = 0
    const activity = terminalActivity(() => {
      deliveries += 1
      return Promise.resolve({
        action: 'updated',
        url: 'https://example.test/pull/125',
        reason: '',
        recoverable: false,
        fallback: false,
      })
    })

    // when
    const stopped = await runTerminal({
      run,
      activity,
      ctx: terminalContext(run),
      accepted: true,
    })

    // then
    expect(stopped.kind).toBe('waiting')
    expect(deliveries).toBe(0)
    expect(
      outstandingCommits(run).map((warning) => warning.activities),
    ).toEqual([['build']])
    expect(gitIn(dir, 'diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('test.txt')
    expect(gitIn(dir, 'diff', '--cached', '--name-only')).toBe('work.txt')
    expect(
      run.tracer
        .eventsNamed(run.runId, COMMIT_REFUSED_EVENT)
        .map((refusal) => refusal.activity),
    ).toEqual(['build', 'test', 'build'])
    expect(
      run.tracer.activityRunsFor(run.runId).map((row) => row.params.name),
    ).toEqual(['build', 'test'])
    expect(
      readFileSync(stopped.kind === 'waiting' ? stopped.request : '', 'utf8'),
    ).toContain('build still requires approval')
    expect(
      readRunState(run.tracer.dbPath, run.runId)?.warnings.map(
        (warning) => warning.activities,
      ),
    ).toEqual([['build']])
    expect(
      finishWaiting(run, stopped.kind === 'waiting' ? stopped.request : ''),
    ).toBe(EXIT.WAITING)

    // when
    rmSync(hook)
    const resumed = await runTerminal({
      run,
      activity,
      ctx: terminalContext(run),
      accepted: true,
    })
    const exit = finish(run)
    const state = readRunState(run.tracer.dbPath, run.runId)

    // then
    expect(resumed).toEqual({ kind: 'settled' })
    expect(exit).toBe(EXIT.SUCCESS)
    expect(deliveries).toBe(1)
    expect(gitIn(dir, 'rev-list', '--count', 'HEAD')).toBe('3')
    expect(gitIn(dir, 'show', 'HEAD:work.txt')).toBe('after')
    expect(gitIn(dir, 'show', 'HEAD:test.txt')).toBe('verification work')
    expect(outstandingCommits(run)).toEqual([])
    expect(state?.status).toBe('success')
    expect(state?.warnings).toEqual([])
    expect(state?.activityRuns.at(-1)?.gates).toMatchObject([
      { gate: 'pull_request_opened', passed: true },
    ])
    expect(
      run.tracer
        .eventsNamed(run.runId, 'tree_warning')
        .filter((warning) => warning.kind === 'recovered')
        .map((warning) => warning.activities),
    ).toEqual([['test'], ['build']])
  },
)
