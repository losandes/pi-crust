import { expect, test } from 'bun:test'
import {
  describeTrust,
  parseTrustLevel,
  stanceFor,
  TRUST_DEFAULT,
  trustLevel,
  trustStance,
} from './trust'

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when a level between the activities is given',
    'it should round to the nearest ten',
  ].join(', '),
  () => {
    // given — the dial is documented in tens, so 47 is a typo or a guess
    const given = '47'

    // when
    const actual = parseTrustLevel(given)

    // then
    expect(actual).toBe(50)
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when the value is beyond the dial',
    'it should clamp rather than inventing a level nothing handles',
  ].join(', '),
  () => {
    // given
    const given = '400'

    // when
    const actual = parseTrustLevel(given)

    // then
    expect(actual).toBe(100)
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when the value is not a number at all',
    'it should fall back to the default rather than to zero',
  ].join(', '),
  () => {
    // given — an exported variable holding a typo must not silently become
    // the most conservative setting and halve every run's speed unexplained.
    //
    // This used to say 'high', which was a typo until the day the dial grew
    // names and 'high' became a level. An example that quietly turns into a
    // valid input tests nothing.
    const given = 'hgih'

    // when
    const actual = parseTrustLevel(given)

    // then
    expect(actual).toBe(TRUST_DEFAULT)
  },
)

test(
  [
    'given typedefs/trust::trustLevel',
    'when both the flag and the environment are set',
    'it should take the flag',
  ].join(', '),
  () => {
    // given — a flag is typed for one command; a variable outlives the shell
    const env = { CRUST_TRUST_LEVEL: '100' }

    // when
    const actual = trustLevel('30', env)

    // then
    expect(actual).toBe(30)
  },
)

const question = (over: Partial<Parameters<typeof stanceFor>[0]> = {}) => ({
  level: TRUST_DEFAULT,
  answerable: true,
  beyondThisRun: false,
  consequential: true,
  ...over,
})

test(
  [
    'given typedefs/trust::stanceFor',
    'when the dial is at zero',
    'it should stop even for a question nobody called consequential',
  ].join(', '),
  () => {
    // given — zero means nothing is left to an agent's judgement
    const params = question({ level: 0, consequential: false })

    // when
    const actual = stanceFor(params)

    // then
    expect(actual).toBe('gate')
  },
)

test(
  [
    'given typedefs/trust::stanceFor',
    'when the dial is low and the question is consequential',
    'it should stop, which is the old behaviour kept deliberately at the bottom',
  ].join(', '),
  () => {
    // given
    const params = question({ level: 20 })

    // when
    const actual = stanceFor(params)

    // then
    expect(actual).toBe('gate')
  },
)

test(
  [
    'given typedefs/trust::stanceFor',
    'when the dial is medium and the stage has an answer it can defend',
    'it should decide rather than stop, however consequential the question',
  ].join(', '),
  () => {
    // given — this is the case that made medium feel lower than low: a
    // consequential question with a perfectly good provisional answer used
    // to stop the run whenever its subject sounded expensive to change
    const params = question({ consequential: true, answerable: true })

    // when
    const actual = stanceFor(params)

    // then
    expect(actual).toBe('answer-provisionally')
  },
)

test(
  [
    'given typedefs/trust::stanceFor',
    'when the dial is medium and the stage has no answer it can defend',
    'it should stop, because proceeding on no answer is invention',
  ].join(', '),
  () => {
    // given
    const params = question({ answerable: false })

    // when
    const actual = stanceFor(params)

    // then
    expect(actual).toBe('gate')
  },
)

test(
  [
    'given typedefs/trust::stanceFor',
    'when the dial is medium and acting would reach beyond this run',
    'it should stop even though the stage knows what it would do',
  ].join(', '),
  () => {
    // given — a push, a deploy, a migration against real data: discarding
    // the run would not undo it, which is the only other honest reason to
    // stop an autonomous chain
    const params = question({ answerable: true, beyondThisRun: true })

    // when
    const actual = stanceFor(params)

    // then
    expect(actual).toBe('gate')
  },
)

test(
  [
    'given typedefs/trust::stanceFor',
    'when the dial is high and the stage could not answer at all',
    'it should still not stop, because high means do not come back',
  ].join(', '),
  () => {
    // given — an unanswerable question at this level is a defect in the
    // report, surfaced at the end. Gating here would make the top of the
    // dial indistinguishable from the middle.
    const params = question({
      level: 100,
      answerable: false,
      beyondThisRun: true,
    })

    // when
    const actual = stanceFor(params)

    // then
    expect(actual).toBe('answer-provisionally')
  },
)

test(
  [
    'given typedefs/trust::trustStance',
    'when each level is rendered for a prompt',
    'it should say something different at every level and never be empty',
  ].join(', '),
  () => {
    // given — the dial was never sent to the agents at all, so the thing
    // most worth asserting is that it now says four distinguishable things
    const levels = [0, 20, 50, 100]

    // when
    const texts = levels.map((level) => trustStance(level))

    // then
    expect(new Set(texts).size).toBe(4)
    expect(texts.every((text) => text.trim() !== '')).toBe(true)
  },
)

test(
  [
    'given typedefs/trust::trustStance',
    'when the level is high',
    'it should tell the agent an empty provisional answer is its own failure',
  ].join(', '),
  () => {
    // given
    const level = 100

    // when
    const text = trustStance(level)

    // then
    expect(text).toContain('must not stop')
    expect(text).toContain('failure of your work')
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when the variable is not set at all',
    'it should be the default, because Number("") is 0 and that is not a choice',
  ].join(', '),
  () => {
    // given
    const given = undefined

    // when
    const actual = parseTrustLevel(given)

    // then
    expect(actual).toBe(TRUST_DEFAULT)
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when the variable is set but empty or blank',
    'it should be the default rather than the most conservative setting',
  ].join(', '),
  () => {
    // given
    const given = '   '

    // when
    const actual = parseTrustLevel(given)

    // then
    expect(actual).toBe(TRUST_DEFAULT)
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when somebody deliberately asks for zero',
    'it should be zero, which is a choice and not an absence',
  ].join(', '),
  () => {
    // given
    const given = '0'

    // when
    const actual = parseTrustLevel(given)

    // then
    expect(actual).toBe(0)
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when a level is given by name',
    'it should resolve to the level that name means',
  ].join(', '),
  () => {
    // given
    const names = ['none', 'low', 'medium', 'high']

    // when
    const levels = names.map((name) => parseTrustLevel(name))

    // then
    expect(levels).toEqual([0, 20, 50, 100])
  },
)

test(
  [
    'given typedefs/trust::parseTrustLevel',
    'when a name arrives in capitals',
    'it should still resolve, because nobody checks their shift key for this',
  ].join(', '),
  () => {
    // given
    const given = 'HIGH'

    // when
    const level = parseTrustLevel(given)

    // then
    expect(level).toBe(100)
  },
)

test(
  [
    'given typedefs/trust::describeTrust',
    'when the level is one of the named ones',
    'it should name it plainly without implying it was adjusted',
  ].join(', '),
  () => {
    // given
    const level = 50

    // when
    const said = describeTrust(level)

    // then
    expect(said).toContain('trust medium (50)')
    expect(said).not.toContain('behaves as')
  },
)

test(
  [
    'given typedefs/trust::describeTrust',
    'when a number lands between thresholds, as 80 does',
    'it should say which band it actually behaves as',
  ].join(', '),
  () => {
    // given — 80 and 50 are the same run, and printing 80 back hid that
    const level = 80

    // when
    const said = describeTrust(level)

    // then
    expect(said).toContain('trust 80 behaves as medium (50)')
  },
)
