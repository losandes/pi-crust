import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { safeParseSettlement } from '../../../../../lib/typedefs'
import { activityRunParams, crustConfigSchema } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import { createTracer } from '../../../trace'
import { createRun } from './create-run'
import { reviseActivity, reviseName } from './revise-loop'
import { runActivityRun } from './run-activity-run'

const RUN_ID = 'legacy0001'
const LEGACY_ARTIFACTS = {
  created: ['plan.md'],
  modified: [],
  deleted: [],
  observed: true,
} as const

const eventsNamed = (dbPath: string, name: string) => {
  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .query<unknown, [string]>(`
      SELECT
        e.payload_json
      FROM events AS e
      WHERE e.type = 'artifacts'
        AND e.name = ?
      ORDER BY e.rowid
    `)
    .all(name)
  db.close()
  return rows.map((row) => {
    const parsed = z.object({ payload_json: z.string() }).parse(row)
    return z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(parsed.payload_json))
  })
}

const seededRun = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-run-revise-ownership-'))
  const data = join(dir, 'data')
  const previousDataDir = process.env.CRUST_DATA_DIR
  using _environment = {
    [Symbol.dispose]: () => {
      if (previousDataDir === undefined) {
        delete process.env.CRUST_DATA_DIR
      } else {
        // biome-ignore lint/plugin/no-object-mutation: this fixture restores the process.env boundary resolveDataPaths reads
        process.env.CRUST_DATA_DIR = previousDataDir
      }
    },
  }
  // biome-ignore lint/plugin/no-object-mutation: this fixture owns the process.env boundary so createRun cannot resolve a real session directory
  process.env.CRUST_DATA_DIR = data
  const dbPath = join(dir, 'crust.db')
  const eventsPath = join(data, 'sessions', RUN_ID, 'events.jsonl')
  const cfg = crustConfigSchema.parse({
    defaults: { data_dir: data },
    observability: { db: dbPath },
    agents: [],
  })
  {
    const tracer = createTracer(dbPath, eventsPath)
    using _seed = { [Symbol.dispose]: () => tracer.close() }
    tracer.sessionStart(RUN_ID, 'tester', 'plan')
    const run = createRun({ cfg, runId: RUN_ID, tracer, engineer: 'tester' })
    const path = join(run.contextHandoffDir, 'plan.md')
    writeFileSync(path, 'plan v1')
    chmodSync(path, 0o444)
    tracer.event({
      run_id: RUN_ID,
      activity_run_id: `${RUN_ID}_01_plan`,
      type: 'artifacts',
      name: 'plan artifacts',
      payload: LEGACY_ARTIFACTS,
    })
  }
  const tracer = createTracer(dbPath, eventsPath)
  const run = createRun({ cfg, runId: RUN_ID, tracer, engineer: 'tester' })
  silenceTerminal()
  return {
    run,
    plan: join(run.contextHandoffDir, 'plan.md'),
    events: (name: string) => eventsNamed(dbPath, name),
    [Symbol.dispose]: () => {
      tracer.close()
      rmSync(dir, { recursive: true, force: true })
      restoreTerminal()
    },
  }
}

const ordinaryWrite = (path: string): string | undefined => {
  const result = safeParseSettlement(() => writeFileSync(path, 'plan v2'))
  return result.status === 'ok'
    ? 'written'
    : (result.error as NodeJS.ErrnoException).code
}

test(
  [
    'given U1 a locked plan document recorded by the old engine',
    'when a fresh run object executes the real revise-plan params',
    'it should rewrite and re-lock the plan without altering its original record',
  ].join(', '),
  async () => {
    // given
    using fixture = seededRun()
    const [planConfig] = crustConfigSchema.parse({
      agents: [],
      activities: [
        {
          name: 'plan',
          output: 'planOutput',
          prompts: { system: 's.md', user: 'u.md' },
        },
      ],
    }).activities
    if (planConfig === undefined) throw new Error('missing plan fixture')
    const params = reviseActivity(
      planConfig,
      {},
      undefined,
      reviseName(planConfig, false),
    ).params

    // when
    const actual = await runActivityRun(fixture.run)(params, () =>
      ordinaryWrite(fixture.plan),
    )

    // then
    expect(actual).toBe('written')
    expect(readFileSync(fixture.plan, 'utf8')).toBe('plan v2')
    const artifacts = fixture.events('revise-plan artifacts')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.modified).toEqual(['plan.md'])
    expect(fixture.events('revise-plan restored')).toHaveLength(0)
    expect(statSync(fixture.plan).mode & 0o222).toBe(0)
    expect(fixture.events('plan artifacts')).toEqual([LEGACY_ARTIFACTS])
  },
)

test(
  [
    'given U2 a locked plan document and an engineer also named plan',
    'when the engineer request attempts an ordinary write to the plan',
    'it should refuse the write without granting ownership by the engineer name',
  ].join(', '),
  async () => {
    // given
    using fixture = seededRun()
    const params = activityRunParams({
      name: 'request',
      kind: 'engineer',
      owner: 'plan',
      description: 'Capture the incoming ask',
    })

    // when
    const actual = await runActivityRun(fixture.run)(params, () =>
      ordinaryWrite(fixture.plan),
    )

    // then
    expect(actual).toBe('EACCES')
    expect(readFileSync(fixture.plan, 'utf8')).toBe('plan v1')
  },
)
