import { expect, test } from 'bun:test'
import type { EventRow } from './types'
import { warningsFor, warningsIn } from './warnings'

const event = (payload: Readonly<Record<string, unknown>>): EventRow =>
  ({
    event_id: 'e1',
    rowid: 1,
    type: 'log',
    name: 'tree_warning',
    payload_json: JSON.stringify(payload),
  }) as EventRow

const warning = {
  kind: 'unexpected',
  activities: ['build'],
  activity_run_ids: ['run_01_build'],
  stage: 'implement',
  paths: ['src/add.ts'],
  note: '',
}

test(
  [
    'given lib/warnings::warningsIn',
    'when the run filed a warning it could not attribute',
    'it should read it back with the paths and the Activities that were running',
  ].join(', '),
  () => {
    // given
    const given = [event(warning)]

    // when
    const actual = warningsIn(given)

    // then
    expect(actual).toEqual([
      {
        kind: 'unexpected',
        activities: ['build'],
        activityRunIds: ['run_01_build'],
        stage: 'implement',
        paths: ['src/add.ts'],
        note: '',
      },
    ])
  },
)

test(
  [
    'given lib/warnings::warningsIn',
    'when a payload was truncated on its way to disk',
    'it should drop that one warning rather than break the page',
  ].join(', '),
  () => {
    // given — a partial write, which has happened
    const given = [
      { ...event(warning), payload_json: '{"kind":' } as EventRow,
      event(warning),
    ]

    // when
    const actual = warningsIn(given)

    // then
    expect(actual).toHaveLength(1)
  },
)

test(
  [
    'given lib/warnings::warningsFor',
    'when a concurrent Stage raised one warning for several Activity Runs',
    'it should show on each of their screens, because each of them was running',
  ].join(', '),
  () => {
    /*
     * given — the Stage warning names every Activity that was running, since
     * which of them changed a path is not a question the tree can answer.
     */
    const given = [
      event({
        ...warning,
        activities: ['review', 'code-review'],
        activity_run_ids: ['run_01_review', 'run_02_code-review'],
        stage: 'accept',
      }),
    ]

    // when
    const mine = warningsFor(given, 'run_02_code-review')
    const somebodyElses = warningsFor(given, 'run_03_document')

    // then
    expect(mine).toHaveLength(1)
    expect(somebodyElses).toEqual([])
  },
)

test(
  [
    'given lib/warnings::warningsIn',
    'when the run filed a warning that a commit failed',
    'it should survive as an uncommitted warning rather than being dropped',
  ].join(', '),
  () => {
    // given
    const given = [
      event({
        kind: 'uncommitted',
        activities: ['build'],
        activity_run_ids: ['run_01_build'],
        stage: 'implement',
        paths: ['src/add.ts'],
        note: 'commit failed: 1Password: failed to fill whole buffer',
      }),
    ]

    // when
    const actual = warningsIn(given)

    // then
    expect(actual).toEqual([
      {
        kind: 'uncommitted',
        activities: ['build'],
        activityRunIds: ['run_01_build'],
        stage: 'implement',
        paths: ['src/add.ts'],
        note: 'commit failed: 1Password: failed to fill whole buffer',
      },
    ])
  },
)
