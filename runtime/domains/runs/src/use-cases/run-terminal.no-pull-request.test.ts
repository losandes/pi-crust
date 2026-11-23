import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { readRunState } from '../../../trace'
import { finish, finishWaiting } from './run-activity-run'
import { runTerminal } from './run-terminal'
import {
  deliveryFixture,
  refuseBuildCommit,
  terminalActivity,
  terminalContext,
} from './run-terminal-fixture.test'

const refused = () =>
  Promise.resolve({
    action: 'refused' as const,
    url: '',
    reason: 'the branch is not ahead of main',
    recoverable: false,
    fallback: false,
  })

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a real run with successful build work',
    'when terminal delivery refuses because the branch is not ahead',
    'it should finish FAILED rather than report delivery success',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run } = fixture
    await fixture.build()

    // when
    await runTerminal({
      run,
      activity: terminalActivity(refused),
      ctx: terminalContext(run),
      accepted: true,
    })
    const actual = finish(run)

    // then
    expect(actual).toBe(EXIT.FAILED)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a real run with successful build work',
    'when terminal delivery refuses because the branch is not ahead',
    'it should persist a failing gate against the terminal Activity Run',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run } = fixture
    await fixture.build()

    // when
    await runTerminal({
      run,
      activity: terminalActivity(refused),
      ctx: terminalContext(run),
      accepted: true,
    })
    using db = new Database(run.tracer.dbPath, { readonly: true })
    const actual = db
      .query<{ passed: number }, []>(`
      SELECT g.passed
      FROM gate_results AS g
      JOIN activity_runs AS a ON a.activity_run_id = g.activity_run_id
      WHERE a.name = 'gh-pull-request'
    `)
      .all()

    // then
    expect(actual.length).toBeGreaterThan(0)
    expect(actual.some((row) => row.passed === 0)).toBe(true)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a real run with successful build work',
    'when terminal delivery creates a pull request',
    'it should retain the successful control verdict',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run } = fixture
    await fixture.build()
    const activity = terminalActivity(() =>
      Promise.resolve({
        action: 'created',
        url: 'https://github.com/losandes/pi-crust/pull/121',
        reason: '',
        recoverable: false,
        fallback: false,
      }),
    )

    // when
    await runTerminal({
      run,
      activity,
      ctx: terminalContext(run),
      accepted: true,
    })
    const actual = finish(run)

    // then
    expect(actual).toBe(EXIT.SUCCESS)
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given ebc4454a: build succeeded but its pre-commit hook refused the commit',
    'when terminal delivery retries while that hook still refuses',
    'it should wait without a terminal row or any delivery attempt',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run } = fixture
    await refuseBuildCommit(run)
    let delivered = 0
    const activity = terminalActivity(() => {
      delivered += 1
      return refused()
    })

    // when
    const actual = await runTerminal({
      run,
      activity,
      ctx: terminalContext(run),
      accepted: true,
    })

    // then
    expect(actual.kind).toBe('waiting')
    expect(delivered).toBe(0)
    expect(
      run.tracer.activityRunsFor(run.runId).map((row) => row.params.name),
    ).toEqual(['build'])
    expect(run.tracer.eventsNamed(run.runId, 'human_gate_open')).toEqual([
      expect.objectContaining({
        kind: 'delivery',
        cause: 'uncommitted',
        activities: ['build'],
      }),
    ])
    expect(
      finishWaiting(run, actual.kind === 'waiting' ? actual.request : ''),
    ).toBe(EXIT.WAITING)
  },
)

for (const cause of ['uncommitted', 'forge'] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given a real run waiting on ${cause}`,
      'when a second process resumes after the operator clears the blocker without an answer file',
      'it should deliver and finish SUCCESS using the same persisted trace',
    ].join(', '),
    async () => {
      // given
      using fixture = deliveryFixture()
      const { dir, run } = fixture
      const hook =
        cause === 'uncommitted' ? await refuseBuildCommit(run) : undefined
      if (cause === 'forge') await fixture.build()
      const activity = terminalActivity(() =>
        Promise.resolve({
          action: 'refused',
          url: '',
          reason: 'git push failed: SSH agent unavailable',
          recoverable: true,
          fallback: false,
        }),
      )
      const stopped = await runTerminal({
        run,
        activity,
        ctx: terminalContext(run),
        accepted: true,
      })
      expect(stopped.kind).toBe('waiting')
      expect(
        finishWaiting(run, stopped.kind === 'waiting' ? stopped.request : ''),
      ).toBe(EXIT.WAITING)
      if (hook !== undefined) rmSync(hook)

      // when
      const child = spawnSync(
        'bun',
        [
          join(import.meta.dir, 'terminal-resume-fixture.test.ts'),
          '--resume-delivery-fixture',
        ],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            CRUST_DATA_DIR: '',
            CRUST_DB: run.tracer.dbPath,
            CRUST_MACHINE_CONFIG: join(dir, 'no-machine-config'),
          },
          timeout: 10_000,
        },
      )
      const state = readRunState(run.tracer.dbPath, run.runId)

      // then
      expect({ status: child.status, stderr: child.stderr }).toEqual({
        status: 0,
        stderr: '',
      })
      expect(state?.status).toBe('success')
      expect(state?.warnings).toEqual([])
      expect(
        state?.activityRuns
          .filter((row) => row.name === 'gh-pull-request')
          .map((row) => row.status),
      ).toEqual(cause === 'forge' ? ['superseded', 'success'] : ['success'])
      if (cause === 'uncommitted') {
        expect(
          run.tracer
            .eventsNamed(run.runId, 'tree_warning')
            .filter((warning) => warning.kind === 'recovered'),
        ).toHaveLength(1)
      }
    },
  )
}
