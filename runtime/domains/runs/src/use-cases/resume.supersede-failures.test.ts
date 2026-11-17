import { expect, test } from 'bun:test'
import { activityRunParams } from '../../../../lib/contracts'
import { gateFixture } from './human-gate-fixture.test'
import { skipIfDone } from './resume'

for (const scenario of [
  { name: 'build', throws: false, statuses: ['superseded', 'success'] },
  { name: 'build', throws: true, statuses: ['superseded', 'fail'] },
  { name: 'review', throws: false, statuses: ['fail', 'success'] },
] as const) {
  test(
    [
      `given an earlier failed ${scenario.name} attempt`,
      `when build ${scenario.throws ? 'throws' : 'returns'}`,
      'it should supersede only the replaced failure before invoking the body',
    ].join(', '),
    async () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      const params = activityRunParams({
        name: scenario.name,
        kind: 'agent',
        owner: scenario.name,
        description: 'Implement the requested change',
      })
      run.tracer.activityRunUpsert({
        activity_run_id: 'earlier',
        run_id: run.runId,
        seq: run.nextSeq(),
        params,
        status: 'fail',
        error: 'original failure',
        started_at: undefined,
        ended_at: undefined,
      })
      const build = { ...params, name: 'build', owner: 'build' }

      // when
      const actual = skipIfDone(
        run,
        build,
        () => {
          expect(run.tracer.activityRunsFor(run.runId)[0]?.status).toBe(
            scenario.statuses[0],
          )
          if (scenario.throws) throw new Error('failed again')
          return 'built'
        },
        async () => 'must not replay',
      )

      // then
      if (scenario.throws) await expect(actual).rejects.toThrow('failed again')
      else expect(await actual).toBe('built')
      const rows = run.tracer.activityRunsFor(run.runId)
      expect(rows.map((row) => row.status)).toEqual([...scenario.statuses])
      expect(rows[0]?.error).toBe('original failure')
    },
  )
}
