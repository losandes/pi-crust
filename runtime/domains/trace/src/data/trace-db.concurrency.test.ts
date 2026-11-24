import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../../../../testing/integration'

// Two independent connections and processes exercise the real SQLite locking boundary.
test.skipIf(SKIP_INTEGRATION)(
  [
    'given two runs opening one new machine trace together',
    'when each writes 200 events while a reader polls',
    'it should retain every event under only its own run',
  ].join(', '),
  async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-trace-concurrency-'))
    const path = join(root, 'crust.db')
    const gate = join(root, 'go')
    const source = join(import.meta.dir, 'trace-db.ts')
    const children = ['repo-a', 'repo-b'].map((runId) =>
      Bun.spawn(
        [
          'bun',
          '-e',
          `
    import { existsSync, writeFileSync } from 'node:fs'
    import { createTracer } from ${JSON.stringify(source)}
    while (!existsSync(${JSON.stringify(gate)})) await Bun.sleep(5)
    const tracer = createTracer(${JSON.stringify(path)}, ${JSON.stringify(join(root, runId, 'events.jsonl'))})
    tracer.sessionStart(${JSON.stringify(runId)}, 'tester', 'concurrent')
    writeFileSync(${JSON.stringify(join(root, `${runId}-ready`))}, 'ready')
    for (let i = 0; i < 200; i++) {
      tracer.event({ run_id: ${JSON.stringify(runId)}, type: 'log', name: 'event-' + i })
      await Bun.sleep(1)
    }
    tracer.sessionFinish(${JSON.stringify(runId)}, true)
    tracer.close()
  `,
        ],
        { env: { ...process.env, HOME: root }, stdout: 'pipe', stderr: 'pipe' },
      ),
    )
    try {
      // when
      writeFileSync(gate, 'go')
      while (
        !['repo-a', 'repo-b'].every((id) =>
          existsSync(join(root, `${id}-ready`)),
        ) &&
        children.every((child) => typeof child.exitCode !== 'number')
      )
        await Bun.sleep(5)
      if (
        ['repo-a', 'repo-b'].every((id) =>
          existsSync(join(root, `${id}-ready`)),
        )
      ) {
        const reader = new Database(path, { readonly: true })
        reader.run('PRAGMA busy_timeout=5000')
        try {
          while (children.some((child) => typeof child.exitCode !== 'number')) {
            expect(
              reader.query('SELECT count(*) AS count FROM events').get(),
            ).toBeDefined()
            await Bun.sleep(5)
          }
        } finally {
          reader.close()
        }
      }
      const results = await Promise.allSettled(
        children.map(async (child) => ({
          status: await child.exited,
          stderr: await new Response(child.stderr).text(),
        })),
      )
      // then
      expect(results).toEqual([
        { status: 'fulfilled', value: { status: 0, stderr: '' } },
        { status: 'fulfilled', value: { status: 0, stderr: '' } },
      ])
      const db = new Database(path, { readonly: true })
      expect(
        db
          .query(
            'SELECT run_id, count(*) AS count FROM events GROUP BY run_id ORDER BY run_id',
          )
          .all(),
      ).toEqual([
        { run_id: 'repo-a', count: 200 },
        { run_id: 'repo-b', count: 200 },
      ])
      expect(db.query('SELECT status FROM sessions').all()).toEqual([
        { status: 'success' },
        { status: 'success' },
      ])
      db.close()
    } finally {
      for (const child of children) child.kill()
      await Promise.allSettled(children.map((child) => child.exited))
      rmSync(root, { recursive: true, force: true })
    }
  },
  20_000,
)
