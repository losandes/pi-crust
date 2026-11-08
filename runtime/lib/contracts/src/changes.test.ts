import { expect, test } from 'bun:test'
import type { TChangeSet } from './changes'
import { baseRefLabel, changeSetEmpty, isRange } from './changes'

test(
  [
    'given typedefs/changes::baseRefLabel',
    'when the base pins a raw 40-character sha',
    'it should shorten it the way a trace reader expects',
  ].join(', '),
  () => {
    // given
    const base = {
      ref: 'a'.repeat(40),
      commit: 'a'.repeat(40),
      reason: 'pinned',
    }

    // when
    const actual = baseRefLabel(base)

    // then
    expect(actual).toEqual('a'.repeat(7))
  },
)

test(
  [
    'given typedefs/changes::changeSetEmpty',
    'when a change set has neither files nor untracked paths',
    'it should report the set as empty',
  ].join(', '),
  () => {
    // given
    const changes: TChangeSet = {
      base: { ref: 'main', commit: 'main', reason: '' },
      files: [],
      untracked: [],
      insertions: 0,
      deletions: 0,
      stat: '',
      diffPath: '',
      truncated: false,
    }

    // when
    const actual = changeSetEmpty(changes)

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given typedefs/changes::changeSetEmpty',
    'when a change set lists at least one file',
    'it should report the set as not empty',
  ].join(', '),
  () => {
    // given
    const changes: TChangeSet = {
      base: { ref: 'main', commit: 'main', reason: '' },
      files: ['src/a.ts'],
      untracked: [],
      insertions: 1,
      deletions: 0,
      stat: '',
      diffPath: '',
      truncated: false,
    }

    // when
    const actual = changeSetEmpty(changes)

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given typedefs/changes::isRange',
    'when the spec is a bare ref with no range separator',
    'it should say so is not a range',
  ].join(', '),
  () => {
    // given, when
    const actual = isRange('HEAD~1')

    // then
    expect(actual).toBe(false)
  },
)
