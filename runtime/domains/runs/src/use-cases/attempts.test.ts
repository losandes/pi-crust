import { expect, test } from 'bun:test'
import {
  attemptLedger,
  FIRST_ATTEMPT,
  gateCause,
  regressionCause,
  reviseCause,
} from './attempts'

test(
  [
    'given use-cases/attempts::attemptLedger',
    'when the same instance runs again',
    'it should count the first run as an attempt, because every execution costs',
  ].join(', '),
  () => {
    // given
    const given = attemptLedger()

    // when
    given.spend('build', FIRST_ATTEMPT)
    given.spend('build', gateCause(['checks: bun test exited 1']))

    // then
    expect(given.spent('build')).toEqual(2)
    expect(given.remaining('build', 2)).toEqual(0)
  },
)

test(
  [
    'given use-cases/attempts::attemptLedger',
    'when a Lifecycle names one Activity twice',
    'it should budget the two instances separately',
  ].join(', '),
  () => {
    /*
     * given — editing a Lifecycle must not change the behaviour of an
     * instance it did not touch. Sharing would make the second pass of a
     * `build, review, build, review` fix loop arrive carrying whatever the
     * first spent.
     */
    const given = attemptLedger()

    // when
    given.spend('test', FIRST_ATTEMPT)
    given.spend('test', gateCause(['diff_matches_claims: a file is missing']))

    // then
    expect(given.remaining('test', 2)).toEqual(0)
    expect(given.remaining('test_2', 2)).toEqual(2)
  },
)

test(
  [
    'given use-cases/attempts::attemptLedger',
    'when the budget is exhausted',
    'it should report every cause that spent it, not only the count',
  ].join(', '),
  () => {
    // given — one number explains nothing to the person being asked
    const given = attemptLedger()
    given.spend('build', FIRST_ATTEMPT)
    given.spend('build', gateCause(['checks: bun test exited 1']))
    given.spend('build', regressionCause('review', 'the plan is wrong'))

    // when
    const actual = given.report('build', 3)

    // then
    expect(actual).toContain("'build' has spent all 3 attempt(s) this run")
    expect(actual).toContain('1. first attempt')
    expect(actual).toContain('2. gate failure: checks: bun test exited 1')
    expect(actual).toContain("3. sent back by 'review': the plan is wrong")
  },
)

test(
  [
    'given use-cases/attempts::attemptLedger',
    'when a session resumes',
    'it should start from what that session already spent, so a budget cannot be refilled by restarting',
  ].join(', '),
  () => {
    // given — the Activity Runs already on this run's record
    const given = attemptLedger(['build', 'build', 'plan'])

    // when
    const actual = given.remaining('build', 2)

    // then
    expect(actual).toEqual(0)
    expect(given.remaining('plan', 2)).toEqual(1)
  },
)

test(
  [
    'given use-cases/attempts::attemptLedger',
    'when nothing of this instance has run',
    'it should have its whole budget, because a replay executes nothing',
  ].join(', '),
  () => {
    // given — a resume past an answered gate replays; it does not re-execute
    const given = attemptLedger([])

    // when
    const actual = given.remaining('review', 2)

    // then
    expect(actual).toEqual(2)
    expect(given.causes('review')).toEqual([])
  },
)

test(
  [
    'given use-cases/attempts::reviseCause',
    'when a revise round spends from the budget',
    'it should say so in the words the exhaustion report uses',
  ].join(', '),
  () => {
    // given
    const given = 2

    // when
    const actual = reviseCause(given)

    // then
    expect(actual).toEqual('revise round 2 after a review that did not approve')
  },
)
