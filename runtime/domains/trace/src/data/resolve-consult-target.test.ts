import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { tokenRepo } from '../../../../testing/token-repo'
import { resolveConsultTarget } from './resolve-consult-target'

for (const situation of [
  'missing-activity',
  'missing-session',
  'owned',
  'malformed',
] as const) {
  test(
    [
      `given a recorded consult target with ${situation}`,
      'when resolving it from the trace',
      'it should settle with the target or the original diagnostic',
    ].join(', '),
    () => {
      // given
      using fixture = tokenRepo()
      const db = new Database(fixture.dbPath)
      if (situation === 'missing-session') db.run('DELETE FROM agent_sessions')
      if (situation === 'owned' || situation === 'malformed') {
        const payloads =
          situation === 'owned'
            ? ['{"created":["build.md",3]}', '{}', '{"created":"not a list"}']
            : ['broken json']
        for (const payload of payloads)
          db.run(
            'INSERT INTO events (run_id, activity_run_id, type, payload_json) VALUES (?,?,?,?)',
            [fixture.runId, `${fixture.runId}_01_build`, 'artifacts', payload],
          )
      }
      db.close()

      // when
      const actual = resolveConsultTarget(fixture.dbPath)(
        fixture.runId,
        situation === 'missing-activity' ? 'missing' : 'build',
      )

      // then
      if (situation === 'missing-activity' || situation === 'missing-session') {
        expect(actual.status).toBe('error')
        if (actual.status === 'error')
          expect(actual.error.message).toContain(
            situation === 'missing-activity'
              ? 'no activity "missing"'
              : 'no recorded session for builder',
          )
      } else {
        expect(actual.status).toBe('ok')
        if (actual.status === 'ok')
          expect(actual.data).toEqual({
            activityRunId: `${fixture.runId}_01_build`,
            agent: 'builder',
            sessionId: 'fixture-session',
            model: 'test/model',
            own: situation === 'owned' ? ['build.md'] : [],
          })
      }
    },
  )
}
