import { expect, test } from 'bun:test'
import type { TActivityRunState } from '../typedefs/run-state'
import {
  activityRunsToCarry,
  activityRunsToSupersede,
  developerNote,
  flagValue,
  seedingOf,
  steerTargetOf,
  steeringAppliedEvent,
  steeringBlock,
  steeringEntry,
  activitiesToReplay,
} from './steer'

const activityRun = (
  seq: number,
  name: string,
  status: string,
): TActivityRunState =>
  ({
    seq,
    activity_run_id: `run_${String(seq).padStart(2, '0')}_${name}`,
    name,
    kind: 'agent',
    owner: name,
    description: '',
    status,
    error: undefined,
    started_at: undefined,
    ended_at: undefined,
    gates: [],
    logs: [],
  }) as TActivityRunState

const RUN: readonly TActivityRunState[] = [
  activityRun(1, 'scout', 'success'),
  activityRun(2, 'conceptualize', 'success'),
  activityRun(3, 'design', 'success'),
  activityRun(4, 'plan', 'success'),
]

test(
  [
    'given use-cases/steer::activitiesToReplay',
    'when a run is sent back to a activity three stages earlier',
    'it should replay that activity and everything after it',
  ].join(', '),
  () => {
    // given — the activities are a chain, each consuming the last one's output,
    // so a change at the start of the chain is a change to all of it.
    // Re-running one in isolation is `amend`, and that is a judgement a
    // person makes deliberately rather than a side effect of steering.

    // when
    const actual = activitiesToReplay(RUN, 'conceptualize')

    // then
    expect(actual).toEqual(['conceptualize', 'design', 'plan'])
  },
)

test(
  [
    'given use-cases/steer::activityRunsToSupersede',
    'when activities have run more than once already',
    'it should supersede only the attempt that was standing',
  ].join(', '),
  () => {
    // given — a activity that already regressed once has two rows, and the
    // earlier one is history. Resume reads the LATEST per name, so marking
    // an old attempt would change nothing and marking both would rewrite
    // what the abandoned path recorded.
    const retried: readonly TActivityRunState[] = [
      activityRun(1, 'scout', 'success'),
      activityRun(2, 'design', 'success'),
      activityRun(3, 'design', 'success'),
      activityRun(4, 'plan', 'fail'),
    ]

    // when
    const actual = activityRunsToSupersede(retried, 'design')

    // then — the second design only; plan did not succeed, so resume would
    // re-run it regardless
    expect(actual).toEqual(['run_03_design'])
  },
)

test(
  [
    'given use-cases/steer::activitiesToReplay',
    'when the named activity never ran in this run',
    'it should replay nothing rather than guess',
  ].join(', '),
  () => {
    // given — a typo in a activity name must not silently re-run the whole run
    // when the caller is about to overwrite its documents

    // when
    const actual = activitiesToReplay(RUN, 'desgin')

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given use-cases/steer::steeringBlock',
    'when a run has been steered',
    'it should be appended to a prompt rather than relying on a placeholder',
  ].join(', '),
  () => {
    // given — a `{{steering}}` variable would be opt-in, and a run where one
    // agent's prompt forgot it is a run that silently ignored the person
    const entry = steeringEntry('design', 'use the registry, not the map', '2026-10-07T00:00:00Z')

    // when
    const actual = steeringBlock(entry)

    // then
    expect(actual).toContain('Steering from the developer')
    expect(actual).toContain('use the registry, not the map')
    expect(actual).toContain('overrides what an earlier pass')
  },
)

test(
  [
    'given use-cases/steer::steeringBlock',
    'when a run has never been steered',
    'it should add nothing at all to the prompt',
  ].join(', '),
  () => {
    // given — every agent in every ordinary run renders this, so an empty
    // one has to be invisible rather than an empty heading

    // when
    const actual = [steeringBlock(''), steeringBlock('   \n  ')]

    // then
    expect(actual).toEqual(['', ''])
  },
)

test(
  [
    'given use-cases/steer::steerTargetOf',
    'when neither --overwrite nor --branch is given',
    'it should refuse to guess',
  ].join(', '),
  () => {
    // given — a default on a choice where one option destroys evidence would
    // be a choice made by habit rather than by a person
    expect(steerTargetOf(['run1', 'design', 'note'])).toBeUndefined()
  },
)

test(
  [
    'given use-cases/steer::steerTargetOf',
    'when both --overwrite and --branch are given',
    'it should refuse rather than pick one',
  ].join(', '),
  () => {
    expect(steerTargetOf(['run1', 'design', '--overwrite', '--branch'])).toBeUndefined()
  },
)

test(
  [
    'given use-cases/steer::steerTargetOf',
    'when exactly one of the two flags is given',
    'it should return that target',
  ].join(', '),
  () => {
    expect(steerTargetOf(['--overwrite'])).toBe('overwrite')
    expect(steerTargetOf(['--branch'])).toBe('branch')
  },
)

test(
  [
    'given use-cases/steer::seedingOf',
    'when --seeding is absent',
    'it should default to fork',
  ].join(', '),
  () => {
    // given — the rejected attempt is usually why somebody is steering
    expect(seedingOf(['--branch'])).toBe('fork')
  },
)

test(
  [
    'given use-cases/steer::seedingOf',
    'when --seeding fresh is given',
    'it should read it',
  ].join(', '),
  () => {
    expect(seedingOf(['--branch', '--seeding', 'fresh'])).toBe('fresh')
  },
)

test(
  [
    'given use-cases/steer::activityRunsToCarry and activityRunsToSupersede',
    'for any activity',
    'the two sets are disjoint and together are every standing successful name',
  ].join(', '),
  () => {
    // given — a reused `latestByName` is what keeps the two from disagreeing
    const retried: readonly TActivityRunState[] = [
      activityRun(1, 'scout', 'success'),
      activityRun(2, 'design', 'fail'),
      activityRun(3, 'design', 'success'),
      activityRun(4, 'plan', 'success'),
    ]

    for (const activity of ['scout', 'design', 'plan']) {
      // when
      const carried = new Set(activityRunsToCarry(retried, activity).map((a) => a.name))
      const superseded = new Set(
        activityRunsToSupersede(retried, activity)
          .map((id) => retried.find((a) => a.activity_run_id === id)?.name ?? ''),
      )
      const standing = new Set(
        retried
          .filter(
            (a) =>
              a.status === 'success' &&
              !retried.some((other) => other.name === a.name && other.seq > a.seq),
          )
          .map((a) => a.name),
      )

      // then — disjoint
      for (const name of carried) expect(superseded.has(name)).toBe(false)
      // and together every standing successful name
      expect(new Set([...carried, ...superseded])).toEqual(standing)
    }
  },
)

test(
  [
    'given use-cases/steer::developerNote',
    'when a person picks a run back up with a note',
    'it should use its own heading, not a send-back sentence',
  ].join(', '),
  () => {
    // when
    const actual = developerNote('I fixed the migration', '2026-01-01T00:00:00.000Z')

    // then
    expect(actual).toContain('## Instruction from the developer at 2026-01-01T00:00:00.000Z')
    expect(actual).toContain('I fixed the migration')
    expect(actual).not.toContain('sent back')
  },
)

test(
  [
    'given use-cases/steer::flagValue',
    'when the flag is followed by another flag or by nothing',
    'it should report the flag as valueless',
  ].join(', '),
  () => {
    expect(flagValue(['--seeding'], '--seeding')).toBeUndefined()
    expect(flagValue(['--seeding', '--branch'], '--seeding')).toBeUndefined()
    expect(flagValue(['--seeding', 'fresh'], '--seeding')).toBe('fresh')
    expect(flagValue([], '--seeding')).toBeUndefined()
  },
)

test(
  [
    'given use-cases/steer::steeringAppliedEvent',
    'when the steering block is empty or whitespace',
    'it should return undefined so the caller traces nothing',
  ].join(', '),
  () => {
    expect(steeringAppliedEvent('builder', '')).toBeUndefined()
    expect(steeringAppliedEvent('builder', '   \n  ')).toBeUndefined()
  },
)

test(
  [
    'given use-cases/steer::steeringAppliedEvent',
    'when the steering block carries text',
    'it should name the event and carry the text in its payload',
  ].join(', '),
  () => {
    const actual = steeringAppliedEvent('builder', '  use the registry  ')
    expect(actual).toEqual({
      name: 'steering_applied',
      payload: { agent: 'builder', text: 'use the registry' },
    })
  },
)
