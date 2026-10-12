import { expect, test } from 'bun:test'
import { moveItem, orderSteps, visibleSteps } from './step-order'

const CANONICAL = ['identify', 'plan', 'design', 'build', 'verify'] as const

test(
  [
    'given use-cases/step-order::orderSteps',
    'when steps were ticked in any order at all',
    'it should sort them into the running order',
  ].join(' '),
  () => {
    // given — ticked bottom-up, as a person scrolling back up would
    const ticked = ['verify', 'build', 'identify']

    // when
    const chain = orderSteps(ticked, CANONICAL)

    // then
    expect(chain).toEqual(['identify', 'build', 'verify'])
  },
)

test(
  [
    'given use-cases/step-order::orderSteps',
    'when a selected step is missing from the order',
    'it should go last rather than vanish from the chain',
  ].join(' '),
  () => {
    // given
    const ticked = ['document', 'identify']

    // when
    const chain = orderSteps(ticked, CANONICAL)

    // then
    expect(chain).toEqual(['identify', 'document'])
  },
)

test(
  [
    'given use-cases/step-order::visibleSteps',
    'when the config hides some steps',
    'it should drop exactly those from what the menu offers',
  ].join(' '),
  () => {
    // given
    const hidden = ['design', 'verify']

    // when
    const offered = visibleSteps(CANONICAL, hidden)

    // then
    expect(offered).toEqual(['identify', 'plan', 'build'])
  },
)

test(
  [
    'given use-cases/step-order::moveItem',
    'when a step is moved down',
    'it should swap with its neighbour and leave the rest alone',
  ].join(' '),
  () => {
    // given
    const items = ['a', 'b', 'c']

    // when
    const moved = moveItem(items, 0, 1)

    // then
    expect(moved).toEqual(['b', 'a', 'c'])
  },
)

test(
  [
    'given use-cases/step-order::moveItem',
    'when the first item is pushed up again',
    'it should stay put rather than wrap round to the end',
  ].join(' '),
  () => {
    // given
    const items = ['a', 'b', 'c']

    // when
    const moved = moveItem(items, 0, -1)

    // then
    expect(moved).toBe(items)
  },
)
