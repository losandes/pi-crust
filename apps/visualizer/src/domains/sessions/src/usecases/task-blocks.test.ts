import { expect, test } from 'bun:test'
import type { ActivityRun } from '@/domains/activity-runs'
import type { EventRow } from '@/domains/events'
import { ts } from '@/lib/format'
import { taskBlocks } from './task-blocks'

const START = '2026-11-26T00:00:00.000Z'
const END = '2026-11-26T00:00:30.000Z'
const run: ActivityRun = {
  activity_run_id: 'build',
  run_id: 'run',
  seq: 1,
  name: 'build',
  kind: 'agent',
  owner: 'builder',
  description: '',
  status: 'success',
  error: '',
  started_at: '2026-11-25T23:59:00.000Z',
  ended_at: START,
}
const event = (
  overrides: Partial<EventRow> = {},
  payload: Readonly<Record<string, unknown>> = {},
): EventRow => ({
  rowid: 1,
  event_id: 'event',
  run_id: 'run',
  activity_run_id: 'build',
  parent_id: '',
  type: 'log',
  name: 'task_end',
  tokens: 0,
  started_at: START,
  ended_at: END,
  payload_json: JSON.stringify({
    task: 'test',
    execution: 'one',
    moment: 'change',
    passed: true,
    ...payload,
  }),
  ...overrides,
})

test(
  [
    'given a successful task lasting thirty seconds',
    'when projecting its end event without a start event',
    'it should draw a named code block from the span columns',
  ].join(', '),
  () => {
    // given
    const end = event({}, { started_at: 'wrong', ended_at: 'wrong' })
    // when
    const actual = taskBlocks([end], [run], false)
    // then
    expect(actual).toHaveLength(1)
    expect(actual[0]).toMatchObject({
      selects: 'build',
      block: {
        activity_run_id: 'task:one',
        run_id: 'run',
        name: 'test',
        kind: 'code',
        owner: 'pi-crust',
        status: 'success',
        started_at: START,
        ended_at: END,
      },
    })
    expect(
      ts(actual[0]?.block.ended_at) - ts(actual[0]?.block.started_at),
    ).toBe(30000)
  },
)

for (const passed of [false, undefined, 'true']) {
  test(
    [
      `given a task end with passed ${String(passed)}`,
      'when projecting task blocks',
      'it should fail unless passed is exactly true',
    ].join(', '),
    () => {
      // given
      const end = event({}, { passed })
      // when
      const actual = taskBlocks([end], [], false)
      // then
      expect(actual[0]?.block.status).toBe('fail')
    },
  )
}

test(
  [
    'given an unfinished task in a running session',
    'when no activity or task started later',
    'it should draw a running block with no end',
  ].join(', '),
  () => {
    // given
    const start = event({ name: 'task_start', ended_at: '' })
    // when
    const actual = taskBlocks([start], [run], true)
    // then
    expect(actual[0]?.block.status).toBe('running')
    expect(actual[0]?.block.ended_at).toBeNull()
  },
)

for (const scenario of [
  'stopped',
  'later activity',
  'later task',
  'paired end',
]) {
  test(
    [
      `given an unfinished task and ${scenario}`,
      'when projecting the session',
      'it should not leave a stale running block',
    ].join(', '),
    () => {
      // given
      const events = [event({ name: 'task_start' })]
      const runs =
        scenario === 'later activity' ? [{ ...run, started_at: END }] : [run]
      const extra =
        scenario === 'later task'
          ? [event({ rowid: 2, started_at: END }, { execution: 'two' })]
          : scenario === 'paired end'
            ? [event({ rowid: 2 })]
            : []
      // when
      const actual = taskBlocks(
        [...events, ...extra],
        runs,
        scenario !== 'stopped',
      )
      // then
      expect(actual.filter(({ block }) => block.status === 'running')).toEqual(
        [],
      )
    },
  )
}

test(
  [
    'given unordered copied events with duplicate ends and repeated task names',
    'when pairing by execution rather than event id or parent id',
    'it should keep the lowest-rowid end and distinct chronologically ordered executions',
  ].join(', '),
  () => {
    // given
    const events = [
      event(
        { rowid: 5, started_at: END, ended_at: '2026-11-26T00:01:00.000Z' },
        { execution: 'two' },
      ),
      event({ rowid: 4 }, { passed: false }),
      event({
        rowid: 2,
        name: 'task_start',
        event_id: 'copied-start',
        parent_id: 'old',
      }),
      event({ rowid: 3, event_id: 'copied-end', parent_id: 'unrelated' }),
      event({ rowid: 1, name: 'task_start' }),
    ]
    // when
    const actual = taskBlocks(events, [run], true)
    // then
    expect(
      actual.map(({ block }) => [block.activity_run_id, block.status]),
    ).toEqual([
      ['task:one', 'success'],
      ['task:two', 'success'],
    ])
  },
)

for (const invalid of [
  { payload_json: '{' },
  { payload_json: '[]' },
  { payload_json: '5' },
  { payload_json: '{}' },
  { payload_json: '{"task":"test"}' },
  { payload_json: '{"execution":"one"}' },
  { payload_json: '{"task":"","execution":"one"}' },
  { payload_json: '{"task":"test","execution":""}' },
  { type: 'tool_call' as const },
  { name: 'other' },
  { started_at: 'bad' },
  { ended_at: 'bad' },
]) {
  test(
    [
      `given an invalid task event ${JSON.stringify(invalid)}`,
      'when projecting task blocks',
      'it should ignore the event without throwing',
    ].join(', '),
    () => {
      // given
      const input = event(invalid)
      // when
      const actual = taskBlocks([input], [], true)
      // then
      expect(actual).toEqual([])
    },
  )
}

test(
  [
    'given no task events',
    'when projecting task blocks',
    'it should leave the chart unchanged',
  ].join(', '),
  () => {
    // given
    const events: readonly EventRow[] = []
    // when
    const actual = taskBlocks(events, [run], true)
    // then
    expect(actual).toEqual([])
  },
)

for (const id of ['build', 'unknown', '']) {
  test(
    [
      `given a task attached to ${id || 'no Activity Run'}`,
      'when resolving its click target',
      'it should select only an Activity Run still in the trace',
    ].join(', '),
    () => {
      // given
      const end = event({ activity_run_id: id })
      // when
      const actual = taskBlocks([end], [run], false)
      // then
      expect(actual[0]?.selects).toBe(id === 'build' ? 'build' : undefined)
    },
  )
}

for (const [moment, description] of [
  ['change', 'repository task, run after a change'],
  ['after', 'repository task, run after the stage'],
  ['before', 'repository task, run before the stage'],
  ['deliver', 'repository task, run before delivery'],
  [undefined, 'repository task'],
  ['unknown', 'repository task'],
  ['toString', 'repository task'],
] as const) {
  test(
    [
      `given task moment ${moment ?? 'missing'}`,
      'when describing its block',
      'it should explain when the repository task ran',
    ].join(', '),
    () => {
      // given
      const end = event({}, { moment })
      // when
      const actual = taskBlocks([end], [], false)
      // then
      expect(actual[0]?.block.description).toBe(description)
    },
  )
}
