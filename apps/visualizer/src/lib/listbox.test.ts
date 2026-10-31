import { expect, test } from 'bun:test'
import { listboxKey } from './listbox'

test(
  [
    'given listbox::listboxKey',
    'when ArrowDown is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'ArrowDown'
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when ArrowDown is pressed in the middle of the list',
    'it should move to the next index',
  ].join(', '),
  () => {
    // given
    const key = 'ArrowDown'
    const active = 1
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'move', index: 2 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when ArrowDown is pressed on the last row',
    'it should wrap to the first index',
  ].join(', '),
  () => {
    // given
    const key = 'ArrowDown'
    const active = 2
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'move', index: 0 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when ArrowUp is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'ArrowUp'
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when ArrowUp is pressed in the middle of the list',
    'it should move to the previous index',
  ].join(', '),
  () => {
    // given
    const key = 'ArrowUp'
    const active = 1
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'move', index: 0 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when ArrowUp is pressed on the first row',
    'it should wrap to the last index',
  ].join(', '),
  () => {
    // given
    const key = 'ArrowUp'
    const active = 0
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'move', index: 2 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Home is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'Home'
    const active = 2
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Home is pressed',
    'it should move to the first index',
  ].join(', '),
  () => {
    // given
    const key = 'Home'
    const active = 2
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'move', index: 0 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when End is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'End'
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when End is pressed',
    'it should move to the last index',
  ].join(', '),
  () => {
    // given
    const key = 'End'
    const active = 0
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'move', index: 2 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Enter is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'Enter'
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Enter is pressed on an active row',
    'it should select that index',
  ].join(', '),
  () => {
    // given
    const key = 'Enter'
    const active = 1
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'select', index: 1 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Space is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = ' '
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Space is pressed on an active row',
    'it should select that index',
  ].join(', '),
  () => {
    // given
    const key = ' '
    const active = 2
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'select', index: 2 })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Escape is pressed with an empty list',
    'it should close the list',
  ].join(', '),
  () => {
    // given
    const key = 'Escape'
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'close' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when Escape is pressed with rows present',
    'it should close the list',
  ].join(', '),
  () => {
    // given
    const key = 'Escape'
    const active = 1
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'close' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when an unrelated key is pressed with an empty list',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'Tab'
    const active = 0
    const count = 0

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)

test(
  [
    'given listbox::listboxKey',
    'when an unrelated key is pressed with rows present',
    'it should do nothing',
  ].join(', '),
  () => {
    // given
    const key = 'Tab'
    const active = 1
    const count = 3

    // when
    const actual = listboxKey(key, active, count)

    // then
    expect(actual).toEqual({ kind: 'none' })
  },
)
