import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TActivityRun } from '../typedefs/activity-run'
import { activityRunParams } from '../typedefs/activity-run'
import type { TActivityContext } from '../typedefs/runnable-activity'
import type { TRun } from '../typedefs/run'
import { runTerminal } from './run-terminal'
import type { TTerminalActivity } from './activities/gh-pull-request'

/** Every row and event the fake run recorded, so a test can read what was filed. */
const runIn = (
  countedRuns: readonly TActivityRun[] = [],
): Readonly<{ run: TRun; rows: TActivityRun[]; events: Record<string, unknown>[] }> => {
  const rows: TActivityRun[] = []
  const events: Record<string, unknown>[] = []
  let seq = 10
  const contextHandoffDir = mkdtempSync(join(tmpdir(), 'crust-run-terminal-'))
  const run = {
    runId: 'dddd4444',
    engineer: 'tester',
    vcsRoot: '/does-not-matter',
    contextHandoffDir,
    resume: new Set<string>(),
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
        ...(rows.find((one) => one.activity_run_id === activityRunId) ?? rows[0]),
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
      eventsNamed: () => [],
      event: (payload: Record<string, unknown>) => {
        // biome-ignore lint/plugin/no-array-mutation: recording what was filed is the test
        events.push(payload)
      },
    },
    console: {
      note: () => undefined,
      activityRunStarted: () => undefined,
      activityRunEnded: () => undefined,
    },
  } as unknown as TRun

  return { run, rows, events }
}

const ctx = { prompt: 'do the thing' } as unknown as TActivityContext

const aTerminalActivity = (
  deliver: TTerminalActivity['deliver'],
): TTerminalActivity => ({
  name: 'gh-pull-request',
  params: activityRunParams({
    name: 'gh-pull-request',
    kind: 'agent',
    owner: 'gh-pull-request',
    description: 'Open or update one pull request',
  }),
  requires: ['gh-pull-request'],
  deliver,
})

test(
  [
    'given use-cases/run-terminal::runTerminal',
    'when the run was not accepted',
    'it should record the row cancelled and never call deliver',
  ].join(', '),
  async () => {
    // given
    const { run, rows } = runIn()
    let delivered = false
    const activity = aTerminalActivity(() => {
      delivered = true
      return Promise.resolve({ action: 'created', url: '', reason: '', fallback: false })
    })

    // when
    await runTerminal({ run, activity, ctx, accepted: false })

    // then
    expect(delivered).toBe(false)
    expect(rows.at(-1)?.status).toEqual('cancelled')
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
    const { run, rows } = runIn([failed])
    let delivered = false
    const activity = aTerminalActivity(() => {
      delivered = true
      return Promise.resolve({ action: 'created', url: '', reason: '', fallback: false })
    })

    // when
    await runTerminal({ run, activity, ctx, accepted: true })

    // then
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
    const { run, rows } = runIn([succeeded])
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
    const terminalRow = rows.findLast((one) => one.params.name === 'gh-pull-request')
    expect(terminalRow?.params.kind).toEqual('agent')
    expect(terminalRow?.status).toEqual('success')
  },
)
