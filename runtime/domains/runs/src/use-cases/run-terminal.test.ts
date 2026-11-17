import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  TActivityContext,
  TActivityRun,
  TEventPayload,
  TGateReport,
  TRun,
} from '../../../../lib/contracts'
import { activityRunParams } from '../../../../lib/contracts'
import { SKIP_INTEGRATION } from '../../../../testing/integration'
import { terminalOutput } from '../../../../testing/terminal-capture'
import type { TTerminalActivity } from '../../../activities'
import { readRunState } from '../../../trace'
import { outstandingCommits } from './deliver'
import { CANCELLED_BY_FAILURE, runTerminal } from './run-terminal'
import {
  deliveryFixture,
  gitIn,
  refuseBuildCommit,
  terminalActivity,
  terminalContext,
} from './run-terminal-fixture.test'

/** Every row and event the fake run recorded, so a test can read what was filed. */
const runIn = (
  countedRuns: readonly TActivityRun[] = [],
  cancellations: readonly TEventPayload[] = [],
): Readonly<{
  run: TRun
  rows: TActivityRun[]
  events: Record<string, unknown>[]
  gates: readonly Readonly<{ id: string; name: string; report: TGateReport }>[]
  rendered: readonly Readonly<{ name: string; report: TGateReport }>[]
  [Symbol.dispose]: () => void
}> => {
  const rows: TActivityRun[] = []
  const events: Record<string, unknown>[] = []
  let gates: readonly Readonly<{
    id: string
    name: string
    report: TGateReport
  }>[] = []
  let rendered: readonly Readonly<{ name: string; report: TGateReport }>[] = []
  let seq = 10
  const contextHandoffDir = mkdtempSync(join(tmpdir(), 'crust-run-terminal-'))
  const run = {
    runId: 'dddd4444',
    engineer: 'tester',
    vcsRoot: '/does-not-matter',
    contextHandoffDir,
    resume: new Set<string>(),
    cfg: { observability: { db: '/unused.db' } },
    tokens: () => 0,
    cost: () => 0,
    nextSeq: () => {
      seq += 1
      return seq
    },
    recordActivityRun: (row: TActivityRun) => {
      // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
      rows.push(row)
    },
    updateActivityRun: (
      activityRunId: string,
      patch: Readonly<{ status?: string; error?: string; ended_at?: string }>,
    ) => {
      const updated = {
        ...(rows.find((one) => one.activity_run_id === activityRunId) ??
          rows[0]),
        ...patch,
      } as TActivityRun
      // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
      rows.push(updated)
      return updated
    },
    tracer: {
      activityRunsFor: () => countedRuns,
      activityRunUpsert: (row: TActivityRun) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
        rows.push(row)
      },
      eventsNamed: (_runId: string, name: string) =>
        name === 'terminal_cancelled' ? cancellations : [],
      sessionFinish: () => undefined,
      gateRow: (row: TActivityRun, name: string, report: TGateReport) => {
        gates = [...gates, { id: row.activity_run_id, name, report }]
      },
      event: (payload: Record<string, unknown>) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
        events.push(payload)
      },
    },
    console: {
      note: () => undefined,
      activityRunStarted: () => undefined,
      activityRunEnded: () => undefined,
      sessionFinished: () => undefined,
      gateResult: (name: string, report: TGateReport) => {
        rendered = [...rendered, { name, report }]
      },
    },
  } as unknown as TRun

  return {
    run,
    rows,
    events,
    get gates() {
      return gates
    },
    get rendered() {
      return rendered
    },
    [Symbol.dispose]: () =>
      rmSync(contextHandoffDir, { recursive: true, force: true }),
  }
}

const ctx = { prompt: 'do the thing' } as unknown as TActivityContext

const aTerminalActivity = (
  deliver: (
    ...params: Parameters<TTerminalActivity['deliver']>
  ) => Promise<
    Omit<Awaited<ReturnType<TTerminalActivity['deliver']>>, 'recoverable'>
  >,
): TTerminalActivity => ({
  name: 'gh-pull-request',
  params: activityRunParams({
    name: 'gh-pull-request',
    kind: 'agent',
    owner: 'gh-pull-request',
    description: 'Open or update one pull request',
  }),
  requires: ['gh-pull-request'],
  requiresCommitting: true,
  deliver: async (ctx, handle) => ({
    recoverable: false,
    ...(await deliver(ctx, handle)),
  }),
})

test(
  [
    'given use-cases/run-terminal::runTerminal',
    'when the run was not accepted',
    'it should wait without a terminal row and never call deliver',
  ].join(', '),
  async () => {
    // given
    using fixture = runIn()
    const { run, rows } = fixture
    let delivered = false
    const activity = aTerminalActivity(() => {
      delivered = true
      return Promise.resolve({
        action: 'created',
        url: '',
        reason: '',
        fallback: false,
      })
    })

    // when
    const actual = await runTerminal({
      run,
      activity,
      ctx,
      accepted: false,
      reason: 'The revise budget is exhausted — see handoff/disputes.md',
    })

    // then
    expect(actual.kind).toBe('waiting')
    expect(fixture.gates).toEqual([])
    expect(delivered).toBe(false)
    expect(rows).toEqual([])
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        name: 'human_gate_open',
        activity_run_id: '',
        payload: expect.objectContaining({ kind: 'acceptance' }),
      }),
    )
    expect(
      readFileSync(join(run.contextHandoffDir, 'decision-request.md'), 'utf8'),
    ).toContain('The revise budget is exhausted — see handoff/disputes.md')
  },
)

test(
  [
    'given use-cases/run-terminal::runTerminal',
    'when a counted activity run in this run failed',
    'it should record the row cancelled and never call deliver',
  ].join(', '),
  async () => {
    // given
    const failed = {
      activity_run_id: 'id_build',
      run_id: 'dddd4444',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'implement the plan',
      }),
      status: 'fail',
      error: 'boom',
      started_at: undefined,
      ended_at: undefined,
    } satisfies TActivityRun
    using fixture = runIn([failed])
    const { run, rows } = fixture
    let delivered = false
    const activity = aTerminalActivity(() => {
      delivered = true
      return Promise.resolve({
        action: 'created',
        url: '',
        reason: '',
        fallback: false,
      })
    })

    // when
    await runTerminal({ run, activity, ctx, accepted: true })

    // then
    expect(fixture.gates).toEqual([])
    expect(delivered).toBe(false)
    expect(rows.at(-1)?.status).toEqual('cancelled')
  },
)

test(
  [
    'given use-cases/run-terminal::runTerminal',
    'when the run was accepted and every counted activity run succeeded',
    'it should run the activity as an agent row and call deliver once',
  ].join(', '),
  async () => {
    // given
    const succeeded = {
      activity_run_id: 'id_build',
      run_id: 'dddd4444',
      seq: 1,
      params: activityRunParams({
        name: 'build',
        kind: 'agent',
        owner: 'build',
        description: 'implement the plan',
      }),
      status: 'success',
      error: undefined,
      started_at: undefined,
      ended_at: undefined,
    } satisfies TActivityRun
    using fixture = runIn([succeeded])
    const { run, rows } = fixture
    let deliverCalls = 0
    const activity = aTerminalActivity(() => {
      deliverCalls += 1
      return Promise.resolve({
        action: 'created',
        url: 'https://example.com/pr/1',
        reason: '',
        fallback: false,
      })
    })

    // when
    await runTerminal({ run, activity, ctx, accepted: true })

    // then
    expect(deliverCalls).toEqual(1)
    const terminalRow = rows.findLast(
      (one) => one.params.name === 'gh-pull-request',
    )
    expect(terminalRow?.params.kind).toEqual('agent')
    expect(terminalRow?.status).toEqual('success')
    expect(fixture.gates).toEqual([
      {
        id: terminalRow?.activity_run_id ?? '',
        name: 'pull_request_opened',
        report: {
          checks: [
            {
              item: 'pull request',
              ok: true,
              note: 'created https://example.com/pr/1',
            },
          ],
        },
      },
    ])
    expect(fixture.rendered).toEqual(
      fixture.gates.map(({ name, report }) => ({ name, report })),
    )
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        type: 'gate_pass',
        name: 'pull_request_opened',
        payload: { violations: [], checks: fixture.gates[0]?.report.checks },
      }),
    )
  },
)

test(
  [
    'given a non-recoverable terminal refusal',
    'when runTerminal judges delivery',
    'it should record a failing gate and settle the row fail without throwing',
  ].join(', '),
  async () => {
    // given
    using fixture = runIn()
    const activity = terminalActivity(() =>
      Promise.resolve({
        action: 'refused',
        url: '',
        reason: 'not ahead',
        recoverable: false,
        fallback: false,
      }),
    )

    // when
    const actual = await runTerminal({
      run: fixture.run,
      activity,
      ctx,
      accepted: true,
    })

    // then
    expect(actual).toEqual({ kind: 'settled' })
    expect(fixture.rows.at(-1)).toMatchObject({
      status: 'fail',
      error: 'failed its gates: pull request: none opened — not ahead',
    })
    expect(fixture.gates).toEqual([
      {
        id: fixture.rows.at(-1)?.activity_run_id ?? '',
        name: 'pull_request_opened',
        report: {
          checks: [
            {
              item: 'pull request',
              ok: false,
              note: 'none opened — not ahead',
            },
          ],
        },
      },
    ])
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        type: 'gate_fail',
        name: 'pull_request_opened',
        payload: {
          violations: ['pull request: none opened — not ahead'],
          checks: fixture.gates[0]?.report.checks,
        },
      }),
    )
    expect(fixture.rendered).toEqual(
      fixture.gates.map(({ name, report }) => ({ name, report })),
    )
  },
)

test(
  [
    'given a terminal delivery that throws',
    'when runTerminal executes it',
    'it should propagate the rejection without judging delivery gates',
  ].join(', '),
  async () => {
    // given
    using fixture = runIn()
    const activity = terminalActivity(() => {
      throw new Error('forge exploded')
    })

    // when, then
    await expect(
      runTerminal({ run: fixture.run, activity, ctx, accepted: true }),
    ).rejects.toThrow('forge exploded')
    expect(fixture.gates).toEqual([])
    expect(fixture.rows.at(-1)?.status).toBe('fail')
  },
)

const previousRow = (
  name: string,
  status: TActivityRun['status'],
): TActivityRun => ({
  activity_run_id: `previous_${name}`,
  run_id: 'dddd4444',
  seq: 1,
  params: activityRunParams({
    name,
    kind: 'agent',
    owner: name,
    description: 'An earlier attempt',
  }),
  status,
  error: undefined,
  started_at: undefined,
  ended_at: undefined,
})

for (const status of ['fail', 'waiting', 'cancelled'] as const) {
  test(
    [
      `given the terminal Activity's earlier ${status} row`,
      'when accepted delivery is retried with no other failed rows',
      'it should supersede only that row and deliver again',
    ].join(', '),
    async () => {
      // given
      const earlier = previousRow('gh-pull-request', status)
      using fixture = runIn(
        [earlier],
        [{ activity: 'gh-pull-request', reason: CANCELLED_BY_FAILURE }],
      )
      let delivered = 0
      const activity = terminalActivity(() => {
        delivered += 1
        return Promise.resolve({
          action: 'created',
          url: 'https://example.test/pull/125',
          reason: '',
          recoverable: false,
          fallback: false,
        })
      })

      // when
      await runTerminal({ run: fixture.run, activity, ctx, accepted: true })

      // then
      expect(delivered).toBe(1)
      expect(
        fixture.rows.find(
          (row) => row.activity_run_id === earlier.activity_run_id,
        )?.status,
      ).toBe('superseded')
      expect(earlier.status).toBe(status)
      expect(fixture.events).toContainEqual({
        run_id: fixture.run.runId,
        activity_run_id: earlier.activity_run_id,
        type: 'log',
        name: 'terminal_superseded',
        payload: {
          activity: 'gh-pull-request',
          reason: 'the terminal Activity is running again',
        },
      })
      expect(fixture.rows.at(-1)?.status).toBe('success')
    },
  )
}

for (const given of [
  { status: 'fail' as const, accepted: true, otherFailed: true },
  { status: 'waiting' as const, accepted: false, otherFailed: true },
  { status: 'cancelled' as const, accepted: true, otherFailed: true },
]) {
  test(
    [
      `given an earlier ${given.status} terminal row, accepted=${given.accepted}, other failed=${given.otherFailed}`,
      'when delivery cannot proceed',
      'it should cancel without superseding the earlier terminal row or judging gates',
    ].join(', '),
    async () => {
      // given
      const earlier = previousRow('gh-pull-request', given.status)
      using fixture = runIn(
        [earlier, ...(given.otherFailed ? [previousRow('build', 'fail')] : [])],
        [{ activity: 'gh-pull-request', reason: CANCELLED_BY_FAILURE }],
      )
      const activity = terminalActivity(() => {
        throw new Error('delivery must not run')
      })

      // when
      await runTerminal({
        run: fixture.run,
        activity,
        ctx,
        accepted: given.accepted,
      })

      // then
      expect(fixture.rows.at(-1)?.status).toBe('cancelled')
      expect(fixture.rows.some((row) => row.status === 'superseded')).toBe(
        false,
      )
      expect(
        fixture.events.some((event) => event.name === 'terminal_superseded'),
      ).toBe(false)
      expect(earlier.status).toBe(given.status)
      expect(fixture.gates).toEqual([])
    },
  )
}

for (const scenario of [
  {
    name: 'recorded rejection',
    reason: 'the person rejected the run — alice',
    accepted: true,
    rejectedBy: undefined,
    otherActivity: false,
    delivered: false,
    outcome: 'settled',
  },
  {
    name: 'unknown recorded reason',
    reason: 'the run was not accepted',
    accepted: true,
    rejectedBy: undefined,
    otherActivity: false,
    delivered: false,
    outcome: 'settled',
  },
  {
    name: 'current rejection',
    reason: CANCELLED_BY_FAILURE,
    accepted: true,
    rejectedBy: 'alice',
    otherActivity: false,
    delivered: false,
    outcome: 'settled',
  },
  {
    name: 'acceptance still owed',
    reason: CANCELLED_BY_FAILURE,
    accepted: false,
    rejectedBy: undefined,
    otherActivity: false,
    delivered: false,
    outcome: 'waiting',
  },
  {
    name: 'another terminal rejected',
    reason: 'the person rejected the run — alice',
    accepted: true,
    rejectedBy: undefined,
    otherActivity: true,
    delivered: true,
    outcome: 'settled',
  },
  {
    name: 'no recorded cancellation event',
    reason: undefined,
    accepted: true,
    rejectedBy: undefined,
    otherActivity: false,
    delivered: true,
    outcome: 'settled',
  },
] as const) {
  test(
    [
      `given an earlier cancelled delivery and ${scenario.name}`,
      'when terminal delivery is considered again',
      'it should recover only failure cancellations after acceptance without rejection',
    ].join(', '),
    async () => {
      // given
      const earlier = previousRow('gh-pull-request', 'cancelled')
      using fixture = runIn(
        [earlier],
        scenario.reason === undefined
          ? []
          : [
              { activity: 'gh-pull-request', reason: CANCELLED_BY_FAILURE },
              {
                activity: scenario.otherActivity
                  ? 'another-terminal'
                  : 'gh-pull-request',
                reason: scenario.reason,
              },
            ],
      )
      let delivered = 0
      const activity = terminalActivity(() => {
        delivered += 1
        return Promise.resolve({
          action: 'created',
          url: 'https://example.test/pull/166',
          reason: '',
          recoverable: false,
          fallback: false,
        })
      })

      // when
      const actual = await runTerminal({
        run: fixture.run,
        activity,
        ctx,
        accepted: scenario.accepted,
        ...(scenario.rejectedBy === undefined
          ? {}
          : { rejectedBy: scenario.rejectedBy }),
      })

      // then
      expect(actual.kind).toBe(scenario.outcome)
      expect(delivered).toBe(scenario.delivered ? 1 : 0)
      expect(fixture.rows.some((row) => row.status === 'superseded')).toBe(
        scenario.delivered,
      )
      if (scenario.outcome !== 'waiting')
        expect(fixture.rows.at(-1)?.status).toBe(
          scenario.delivered ? 'success' : 'cancelled',
        )
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a commit git refused earlier and an operator who removed the hook',
    'when accepted terminal delivery starts',
    'it should land the refused work before calling deliver once',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    const hook = await refuseBuildCommit(run)
    rmSync(hook)
    const before = gitIn(dir, 'rev-parse', 'HEAD')
    let commitsAtDelivery = ''
    let delivered = 0
    const activity = terminalActivity(() => {
      delivered += 1
      commitsAtDelivery = gitIn(dir, 'rev-parse', 'HEAD')
      expect(outstandingCommits(run)).toEqual([])
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
      accepted: true,
    })

    // then
    expect(actual).toEqual({ kind: 'settled' })
    expect(delivered).toBe(1)
    expect(commitsAtDelivery).not.toBe(before)
    expect(gitIn(dir, 'show', 'HEAD:work.txt')).toBe('after')
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given an unaccepted run with a refused commit whose hook is now repaired',
    'when runTerminal reaches delivery',
    'it should request acceptance before retrying any commit or delivering',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run, dir } = fixture
    const hook = await refuseBuildCommit(run)
    rmSync(hook)
    const before = gitIn(dir, 'rev-parse', 'HEAD')
    const activity = terminalActivity(() => {
      throw new Error('delivery must not run')
    })

    // when
    const actual = await runTerminal({
      run,
      activity,
      ctx: terminalContext(run),
      accepted: false,
    })

    // then
    expect(actual.kind).toBe('waiting')
    expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(before)
    expect(outstandingCommits(run)).toHaveLength(1)
    expect(
      run.tracer.eventsNamed(run.runId, 'human_gate_open').at(-1)?.kind,
    ).toBe('acceptance')
    expect(
      run.tracer.activityRunsFor(run.runId).map((row) => row.params.name),
    ).toEqual(['build'])
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a commit still refused after its one retry at delivery',
    'when runTerminal reaches delivery',
    'it should write the request and wait without a terminal row or delivery gate',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run } = fixture
    await refuseBuildCommit(run)
    const activity = terminalActivity(() => {
      throw new Error('delivery must not run')
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
    expect(
      readFileSync(actual.kind === 'waiting' ? actual.request : '', 'utf8'),
    ).toContain('commit refused by hook')
    expect(
      run.tracer.activityRunsFor(run.runId).map((row) => row.params.name),
    ).toEqual(['build'])
    expect(
      readRunState(run.tracer.dbPath, run.runId)?.activityRuns.flatMap(
        (row) => row.gates,
      ),
    ).toEqual([])
  },
)

test(
  [
    'given an operator-recoverable delivery refusal',
    'when runTerminal receives it',
    'it should settle the terminal row waiting and open a delivery request without judging gates',
  ].join(', '),
  async () => {
    // given
    using fixture = runIn()
    const activity = terminalActivity(() =>
      Promise.resolve({
        action: 'refused',
        url: '',
        reason: 'git push failed: SSH agent unavailable',
        recoverable: true,
        fallback: false,
      }),
    )

    // when
    const actual = await runTerminal({
      run: fixture.run,
      activity,
      ctx,
      accepted: true,
    })

    // then
    expect(actual.kind).toBe('waiting')
    expect(fixture.rows.at(-1)?.status).toBe('waiting')
    expect(fixture.gates).toEqual([])
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        activity_run_id: fixture.rows.at(-1)?.activity_run_id,
        name: 'human_gate_open',
        payload: {
          activity: activity.name,
          kind: 'delivery',
          cause: 'forge',
          request: actual.kind === 'waiting' ? actual.request : '',
          activities: [],
          refusal: 'git push failed: SSH agent unavailable',
        },
      }),
    )
  },
)

test.skipIf(SKIP_INTEGRATION)(
  [
    'given a failed delivery gate',
    'when runTerminal settles it',
    'it should print the resume instruction and bound the row error',
  ].join(', '),
  async () => {
    // given
    using fixture = deliveryFixture()
    const { run } = fixture
    const activity = terminalActivity(() =>
      Promise.resolve({
        action: 'refused',
        url: '',
        reason: 'x'.repeat(1200),
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

    // then
    expect(run.tracer.activityRunsFor(run.runId).at(-1)?.error).toHaveLength(
      1000,
    )
    expect(terminalOutput()).toContain(
      'failed its gates — fix what they name, then resume:',
    )
  },
)
