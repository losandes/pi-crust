import { expect, test } from 'bun:test'
import { hasEvidenceShape, namesWord, normalise } from './dispute'

test(
  [
    'given typedefs/dispute::hasEvidenceShape',
    'when the evidence cites a path and a line',
    'it should accept it, with or without a column',
  ].join(', '),
  () => {
    // given
    const cited = ['src/server.ts:42', 'src/a.ts:42:9 is already guarded']

    // when
    const actual = cited.map(hasEvidenceShape)

    // then
    expect(actual).toEqual([true, true])
  },
)

test(
  [
    'given typedefs/dispute::hasEvidenceShape',
    'when the evidence names a command and the status it exited with',
    'it should accept it',
  ].join(', '),
  () => {
    // given
    const cited = ['`bun test` exited 1', 'biome lint: exit status 0']

    // when
    const actual = cited.map(hasEvidenceShape)

    // then
    expect(actual).toEqual([true, true])
  },
)

test(
  [
    'given typedefs/dispute::hasEvidenceShape',
    'when the evidence is prose or a version number',
    'it should reject it, because a refusal is not a dispute',
  ].join(', '),
  () => {
    // given
    const cited = ['this is fine', 'the reviewer is wrong', 'v1.2.3']

    // when
    const actual = cited.map(hasEvidenceShape)

    // then
    expect(actual).toEqual([false, false, false])
  },
)

test(
  [
    'given typedefs/dispute::normalise',
    'when two agents spell the same finding differently',
    'it should fold case, whitespace and trailing punctuation together',
  ].join(', '),
  () => {
    // given
    const spellings = ['The  lint check   failed.', 'the lint check failed']

    // when
    const actual = spellings.map(normalise)

    // then
    expect(actual[0]).toEqual(actual[1])
  },
)

test(
  [
    'given typedefs/dispute::namesWord',
    'when a check name appears inside a longer word',
    'it should not count that as naming the check',
  ].join(', '),
  () => {
    // given
    const text = 'the latest contest results'

    // when
    const actual = [namesWord(text, 'test'), namesWord('the test failed', 'test')]

    // then
    expect(actual).toEqual([false, true])
  },
)
