import { expect, test } from 'bun:test'
import type { TActivityRunState } from '../typedefs/run-state'
import {
  activityRunsToSupersede,
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
    expect(actual).toContain('override what the earlier pass')
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
