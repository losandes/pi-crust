import { expect, test } from 'bun:test'
import type {
  TActivityRun,
  TActivityRunStatus,
} from '../../../../lib/contracts'
import { activityRunParams } from '../../../../lib/contracts'
import { gateFixture } from './human-gate-fixture.test'
import {
  ATTEMPT_SUPERSEDED_EVENT,
  NEVER_SETTLED,
  replacedAttempts,
  supersedeReplacedAttempts,
} from './supersede-replaced-attempts'

const row = (
  seq: number,
  status: TActivityRunStatus,
  name = 'build',
): TActivityRun => ({
  activity_run_id: `wait0117_${seq}_${name}`,
  run_id: 'wait0117',
  seq,
  params: activityRunParams({
    name,
    kind: 'agent',
    owner: name,
    description: 'Implement the requested work',
  }),
  status,
  error: undefined,
  started_at: '2024-01-01T00:00:00.000Z',
  ended_at: undefined,
})

for (const scenario of [
  {
    name: 'failure then success',
    rows: [row(1, 'fail'), row(2, 'success')],
    pairs: [[1, 2]],
  },
  {
    name: 'failure then failure',
    rows: [row(1, 'fail'), row(2, 'fail')],
    pairs: [[1, 2]],
  },
  {
    name: 'two failures then success',
    rows: [row(3, 'success'), row(2, 'fail'), row(1, 'fail')],
    pairs: [
      [1, 3],
      [2, 3],
    ],
  },
  {
    name: 'running then running',
    rows: [row(1, 'running'), row(2, 'running')],
    pairs: [[1, 2]],
  },
  { name: 'failure without a replacement', rows: [row(1, 'fail')], pairs: [] },
  ...['build_2', 'review', 'revise-plan'].map((name) => ({
    name: `different instance ${name}`,
    rows: [row(1, 'fail'), row(2, 'success', name)],
    pairs: [],
  })),
  ...(['superseded', 'cancelled', 'queued', 'blocked'] as const).map(
    (status) => ({
      name: `later ${status}`,
      rows: [row(1, 'fail'), row(2, status)],
      pairs: [],
    }),
  ),
  ...(
    [
      'success',
      'waiting',
      'superseded',
      'cancelled',
      'queued',
      'blocked',
    ] as const
  ).map((status) => ({
    name: `earlier ${status}`,
    rows: [row(1, status), row(2, 'success')],
    pairs: [],
  })),
  {
    name: 'two distinct names replaced',
    rows: [
      row(1, 'fail'),
      row(2, 'fail', 'review'),
      row(3, 'success'),
      row(4, 'success', 'review'),
    ],
    pairs: [
      [1, 3],
      [2, 4],
    ],
  },
  {
    name: 'later waiting attempt',
    rows: [row(1, 'fail'), row(2, 'waiting')],
    pairs: [[1, 2]],
  },
]) {
  test(
    [
      `given ${scenario.name}`,
      'when replaced attempts are selected',
      'it should return only replaced rows in sequence order without changing input',
    ].join(', '),
    () => {
      // given
      const before = structuredClone(scenario.rows)

      // when
      const actual = replacedAttempts(scenario.rows)

      // then
      expect(actual.map(({ replaced, by }) => [replaced.seq, by.seq])).toEqual(
        scenario.pairs,
      )
      expect(scenario.rows).toEqual(before)
    },
  )
}

for (const status of ['fail', 'running'] as const) {
  test(
    [
      `given a replaced ${status} row with recorded diagnostics`,
      'when the marker runs',
      'it should preserve the complete row and record its replacement once',
    ].join(', '),
    () => {
      // given
      using fixture = gateFixture()
      const { run } = fixture
      const earlier = {
        ...row(1, status),
        error: 'boom',
        ended_at: '2024-01-01T00:00:01.000Z',
      }
      const later = row(2, 'success')
      run.tracer.activityRunUpsert(earlier)
      run.tracer.activityRunUpsert(later)

      // when
      const actual = supersedeReplacedAttempts(run)

      // then
      expect(actual).toEqual([{ replaced: earlier, by: later }])
      expect(run.tracer.activityRunsFor(run.runId)).toEqual([
        { ...earlier, status: 'superseded' },
        later,
      ])
      expect(
        run.tracer.eventsNamed(run.runId, ATTEMPT_SUPERSEDED_EVENT),
      ).toEqual([
        { activity: 'build', was: status, replaced_by: later.activity_run_id },
      ])
      expect(supersedeReplacedAttempts(run)).toEqual([])
      expect(
        run.tracer.eventsNamed(run.runId, ATTEMPT_SUPERSEDED_EVENT),
      ).toHaveLength(1)
    },
  )
}

test(
  [
    'given a replaced running row without diagnostics',
    'when the marker runs',
    'it should record the interruption and an end time',
  ].join(', '),
  () => {
    // given
    using fixture = gateFixture()
    const { run } = fixture
    run.tracer.activityRunUpsert(row(1, 'running'))
    run.tracer.activityRunUpsert(row(2, 'running'))

    // when
    supersedeReplacedAttempts(run)

    // then
    expect(run.tracer.activityRunsFor(run.runId)[0]).toMatchObject({
      status: 'superseded',
      error: NEVER_SETTLED,
      ended_at: expect.any(String),
    })
  },
)
