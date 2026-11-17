import { expect, test } from 'bun:test'
import { activityRunParams, EXIT } from '../../../../lib/contracts'
import { readRunState } from '../../../trace'
import { gateFixture } from './human-gate-fixture.test'
import { finish } from './run-activity-run'

for (const scenario of [
  { name: 'build', status: 'success', ok: true, failed: [] },
  { name: 'build', status: 'fail', ok: false, failed: ['later'] },
  { name: 'review', status: 'success', ok: false, failed: ['earlier'] },
  { name: 'build_2', status: 'success', ok: false, failed: ['earlier'] },
] as const) {
  test(
    [
      'given an earlier build failure',
      `when finish judges a later ${scenario.name} ${scenario.status}`,
      'it should judge and summarize only standing attempts',
    ].join(', '),
    () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      const params = activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'Implement the requested change',
      })
      run.tracer.activityRunUpsert({
        activity_run_id: 'earlier',
        run_id: run.runId,
        seq: 1,
        params,
        status: 'fail',
        error: 'boom',
        started_at: undefined,
        ended_at: undefined,
      })
      run.tracer.activityRunUpsert({
        activity_run_id: 'later',
        run_id: run.runId,
        seq: 2,
        params: { ...params, name: scenario.name },
        status: scenario.status,
        error: undefined,
        started_at: undefined,
        ended_at: undefined,
      })

      // when
      const actual = finish(run)

      // then
      expect(actual).toBe(scenario.ok ? EXIT.SUCCESS : EXIT.FAILED)
      expect(readRunState(run.tracer.dbPath, run.runId)?.status).toBe(
        scenario.ok ? 'success' : 'fail',
      )
      expect(run.tracer.activityRunsFor(run.runId)[0]).toMatchObject({
        status: scenario.name === 'build' ? 'superseded' : 'fail',
        error: 'boom',
      })
      const failures = run.tracer.eventsNamed(run.runId, 'activity_runs_failed')
      if (scenario.ok) {
        expect(failures).toEqual([])
        expect(
          run.tracer
            .eventsNamed(run.runId, 'console')
            .map((payload) => String(payload.message ?? ''))
            .join('\n'),
        ).toContain('1/1 activityRuns')
      } else {
        expect(failures).toEqual([
          {
            reason: expect.stringContaining(scenario.failed[0] ?? ''),
            activityRuns: scenario.failed.map((activity_run_id) => ({
              activity_run_id,
              status: 'fail',
            })),
          },
        ])
      }
    },
  )
}
