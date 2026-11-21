import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { tokenRepo } from '../../../../testing/token-repo'
import { recordBranchSteer, recordOverwriteSteer } from './mutate-steer-record'

for (const mode of ['overwrite', 'branch'] as const) {
  test(
    [
      `given a recorded run and a ${mode} steering record`,
      'when persisting the record',
      'it should retain the steering payload and its attribution',
    ].join(', '),
    () => {
      // given
      using fixture = tokenRepo()
      const common = {
        runId: fixture.runId,
        activity: 'build',
        note: 'correct it',
        replaying: ['build'],
        now: () => '2024-01-02T00:00:00.000Z',
      }

      // when
      if (mode === 'overwrite')
        recordOverwriteSteer(fixture.dbPath)({
          ...common,
          superseding: [`${fixture.runId}_01_build`],
        })
      else
        recordBranchSteer(fixture.dbPath)({
          ...common,
          branchId: fixture.runId,
          seeding: 'fork',
          carried: ['plan'],
          at: common.now(),
        })

      // then
      const db = new Database(fixture.dbPath, { readonly: true })
      try {
        const events = db
          .query<{ payload_json: string }, []>(
            "SELECT payload_json FROM events WHERE type='steer'",
          )
          .all()
        expect(events).toHaveLength(1)
        expect(JSON.parse(events[0]?.payload_json ?? '{}')).toMatchObject({
          target: mode,
          activity: 'build',
          note: 'correct it',
        })
      } finally {
        db.close()
      }
    },
  )
}
