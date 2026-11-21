import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWaitingRuns } from './resolve-waiting-runs'

for (const shape of ['missing', 'legacy', 'named', 'unnamed'] as const) {
  test(
    [
      `given a ${shape} session store`,
      'when resolving waiting runs',
      'it should return only waiting runs and normalize absent names',
    ].join(', '),
    () => {
      // given
      const dir = mkdtempSync(join(tmpdir(), 'crust-waiting-'))
      const path = join(dir, 'trace.db')
      try {
        if (shape !== 'missing') {
          const db = new Database(path)
          db.run(
            `CREATE TABLE sessions (run_id TEXT, lifecycle TEXT, status TEXT, started_at TEXT${shape === 'legacy' ? '' : ', name TEXT'})`,
          )
          db.run(
            `INSERT INTO sessions VALUES ('waiting', 'sdlc', 'waiting', '2024-01-02'${shape === 'legacy' ? '' : shape === 'named' ? ", 'named run'" : ', NULL'})`,
          )
          db.run(
            `INSERT INTO sessions VALUES ('done', 'sdlc', 'success', '2024-01-01'${shape === 'legacy' ? '' : ', NULL'})`,
          )
          db.close()
        }

        // when
        const actual = resolveWaitingRuns(path)

        // then
        expect(actual).toEqual(
          shape === 'missing'
            ? []
            : [
                {
                  run_id: 'waiting',
                  lifecycle: 'sdlc',
                  status: 'waiting',
                  started_at: '2024-01-02',
                  name: shape === 'named' ? 'named run' : '',
                },
              ],
        )
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
