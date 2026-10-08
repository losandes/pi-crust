import { expect, test } from 'bun:test'
import {
  effectiveOrder,
  moveItem,
  orderSteps,
  visibleSteps,
} from './step-order'

const CANONICAL = ['identify', 'plan', 'design', 'build', 'verify'] as const

test(
  [
    'given use-cases/step-order::effectiveOrder',
    'when the config names no order',
    'it should keep the built-in one rather than invent a sequence',
  ].join(' '),
  () => {
    // given
    const configured: readonly string[] = []

    // when
    const order = effectiveOrder(configured, CANONICAL)

    // then
    expect(order).toEqual([...CANONICAL])
  },
)

test(
  [
    'given use-cases/step-order::effectiveOrder',
    'when the config names only two steps, to swap them',
    'it should move those two and leave everything else exactly where it was',
  ].join(' '),
  () => {
    // given — design before plan, saying nothing about the other three
    const configured = ['design', 'plan']

    // when
    const order = effectiveOrder(configured, CANONICAL)

    // then
    expect(order).toEqual(['identify', 'design', 'plan', 'build', 'verify'])
  },
)

test(
  [
    'given use-cases/step-order::effectiveOrder',
    'when the config names a step that is not a step',
    'it should ignore the name rather than reject the whole order',
  ].join(' '),
  () => {
    // given
    const configured = ['design', 'analyse', 'plan']

    // when
    const order = effectiveOrder(configured, CANONICAL)

    // then
    expect(order).toEqual(['identify', 'design', 'plan', 'build', 'verify'])
  },
)

test(
  [
    'given use-cases/step-order::effectiveOrder',
    'when a name is listed twice',
    'it should count it once, so the slots and the names cannot disagree',
  ].join(' '),
  () => {
    // given
    const configured = ['plan', 'plan', 'identify']

    // when
    const order = effectiveOrder(configured, CANONICAL)

    // then
    expect(order).toEqual(['plan', 'identify', 'design', 'build', 'verify'])
  },
)

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
