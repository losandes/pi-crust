import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenRepo } from '../../../../testing/token-repo'
import { consultActivity, type TConsultPorts } from './consult-activity'

for (const situation of [
  'usage',
  'missing',
  'session',
  'failed',
  'ask',
  'amend',
] as const) {
  test(
    [
      `given an activity consultation with ${situation}`,
      'when consulting through injected process ports',
      'it should retain validation, ownership and exit behavior',
    ].join(', '),
    async () => {
      // given
      using fixture = tokenRepo({ separateData: true })
      const handoff = join(fixture.sessionDir, 'context_handoff')
      const own = join(handoff, 'build.md')
      const other = join(handoff, 'plan.md')
      writeFileSync(own, 'original build')
      writeFileSync(other, 'original plan')
      const db = new Database(fixture.dbPath)
      db.run(
        'INSERT INTO events (run_id, activity_run_id, type, payload_json) VALUES (?,?,?,?)',
        [
          fixture.runId,
          `${fixture.runId}_01_build`,
          'artifacts',
          JSON.stringify({ created: ['build.md'] }),
        ],
      )
      if (situation === 'session') db.run('DELETE FROM agent_sessions')
      db.close()
      const ports: TConsultPorts = {
        env: {
          ...process.env,
          CRUST_CONFIG: fixture.configPath,
          CRUST_MACHINE_CONFIG: '/nonexistent/crust-machine-config.yaml',
          CRUST_DB: fixture.dbPath,
          CRUST_DATA_DIR: fixture.dataDir,
        },
        cwd: fixture.root,
        say: () => undefined,
        invoke: () => {
          if (situation === 'amend') {
            chmodSync(own, 0o644)
            chmodSync(other, 0o644)
            writeFileSync(own, 'amended build')
            writeFileSync(other, 'unauthorized plan change')
          }
          return Promise.resolve({
            ok: situation !== 'failed',
            output: 'fixture answer',
          })
        },
      }

      // when
      const actual = await consultActivity(ports)(
        situation === 'amend' ? 'amend' : 'ask',
        situation === 'usage'
          ? []
          : [
              fixture.runId,
              situation === 'missing' ? 'missing' : 'build',
              'explain this',
            ],
      )

      // then
      expect(actual).toBe(
        situation === 'usage'
          ? 2
          : ['missing', 'session', 'failed'].includes(situation)
            ? 1
            : 0,
      )
    },
  )
}
