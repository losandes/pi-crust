import { expect, test } from 'bun:test'
import {
  applyExclusiveKey,
  applyKey,
  applySingleKey,
  initialMenu,
  selected,
  visibleWindow,
} from './menu'

test(
  [
    'given use-cases/menu::applyKey',
    'when the cursor is on the first option and moves up',
    'it should wrap to the last, which is otherwise the costliest to reach',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([], 0)

    // when
    const moved = applyKey(state, 'up', 4)

    // then
    expect(moved.cursor).toBe(3)
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when the cursor is on the last option and moves down',
    'it should wrap to the first',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([], 3)

    // when
    const moved = applyKey(state, 'down', 4)

    // then
    expect(moved.cursor).toBe(0)
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when options are toggled out of list order',
    'it should keep them in SELECTION order, because a chain is ordered',
  ].join(' '),
  () => {
    // given
    const start = initialMenu([], 2)

    // when
    const afterBuild = applyKey(start, 'toggle', 4)
    const atPlan = applyKey(afterBuild, 'up', 4)
    const afterPlan = applyKey(applyKey(atPlan, 'up', 4), 'toggle', 4)

    // then
    expect(afterPlan.chosen).toEqual([2, 0])
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when an already-chosen option is toggled again',
    'it should be removed rather than duplicated',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([1], 1)

    // when
    const toggled = applyKey(state, 'toggle', 3)

    // then
    expect(toggled.chosen).toEqual([])
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when the menu has been cancelled',
    'it should ignore every later key rather than resurrect itself',
  ].join(' '),
  () => {
    // given
    const cancelled = applyKey(initialMenu(), 'cancel', 3)

    // when
    const after = applyKey(cancelled, 'toggle', 3)

    // then
    expect(after).toEqual(cancelled)
    expect(after.cancelled).toBe(true)
  },
)

test(
  [
    'given use-cases/menu::applySingleKey',
    'when enter is pressed without tabbing first',
    'it should choose whatever the cursor is on',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([], 2)

    // when
    const submitted = applySingleKey(state, 'submit', 4)

    // then
    expect(submitted.done).toBe(true)
    expect(submitted.chosen).toEqual([2])
  },
)

test(
  [
    'given use-cases/menu::selected',
    'when the state holds indices',
    'it should map them back to options in selection order',
  ].join(' '),
  () => {
    // given
    const options = ['plan', 'build', 'verify'] as const
    const state = initialMenu([2, 0])

    // when
    const chosen = selected(options, state)

    // then
    expect(chosen).toEqual(['verify', 'plan'])
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when the list is empty',
    'it should leave the cursor at zero rather than divide by a zero size',
  ].join(' '),
  () => {
    // given
    const state = initialMenu()

    // when
    const moved = applyKey(state, 'down', 0)

    // then
    expect(moved.cursor).toBe(0)
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when an exclusive default is held and an ordinary option is chosen',
    'it should REPLACE the default rather than append to it',
  ].join(' '),
  () => {
    // given — option 0 is a lifecycle and is preselected, cursor on a activity
    const state = { ...initialMenu([0], 4), cursor: 4 }

    // when
    const after = applyExclusiveKey(state, 'toggle', 8, [0, 1, 2])

    // then
    expect(after.chosen).toEqual([4])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when ordinary options are held and an exclusive one is chosen',
    'it should clear them, because a named chain answers the whole question',
  ].join(' '),
  () => {
    // given
    const state = { ...initialMenu([4, 5], 0), cursor: 0 }

    // when
    const after = applyExclusiveKey(state, 'toggle', 8, [0, 1, 2])

    // then
    expect(after.chosen).toEqual([0])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when two ordinary options are chosen in turn',
    'it should keep both, in selection order',
  ].join(' '),
  () => {
    // given
    const first = applyExclusiveKey(
      { ...initialMenu([], 5), cursor: 5 },
      'toggle',
      8,
      [0, 1, 2],
    )

    // when
    const second = applyExclusiveKey(
      { ...first, cursor: 3 },
      'toggle',
      8,
      [0, 1, 2],
    )

    // then
    expect(second.chosen).toEqual([5, 3])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when the held exclusive option is toggled again',
    'it should leave nothing chosen rather than silently keep it',
  ].join(' '),
  () => {
    // given
    const state = { ...initialMenu([0], 0), cursor: 0 }

    // when
    const after = applyExclusiveKey(state, 'toggle', 8, [0, 1, 2])

    // then
    expect(after.chosen).toEqual([])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when "all" is pressed',
    'it should take every ordinary option and no exclusive one',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([0], 0)

    // when
    const after = applyExclusiveKey(state, 'all', 6, [0, 1])

    // then
    expect(after.chosen).toEqual([2, 3, 4, 5])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when a lifecycle is held and an operator is chosen',
    'it should replace it, because both answer the whole question',
  ].join(' '),
  () => {
    // given — 0..2 are lifecycles, 3 is an operator, 4+ are activities
    const state = { ...initialMenu([0], 3), cursor: 3 }

    // when
    const after = applyExclusiveKey(state, 'toggle', 9, [0, 1, 2, 3])

    // then
    expect(after.chosen).toEqual([3])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when an operator is held and a activity is chosen',
    'it should drop the operator rather than run both',
  ].join(' '),
  () => {
    // given
    const state = { ...initialMenu([3], 6), cursor: 6 }

    // when
    const after = applyExclusiveKey(state, 'toggle', 9, [0, 1, 2, 3])

    // then
    expect(after.chosen).toEqual([6])
  },
)

test(
  [
    'given use-cases/menu::applyExclusiveKey',
    'when activities are held and an operator is chosen',
    'it should clear them, because naming activities is what an operator replaces',
  ].join(' '),
  () => {
    // given
    const state = { ...initialMenu([5, 6], 3), cursor: 3 }

    // when
    const after = applyExclusiveKey(state, 'toggle', 9, [0, 1, 2, 3])

    // then
    expect(after.chosen).toEqual([3])
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when reorder is pressed',
    'it should commit the selection AND ask for an ordering',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([1, 0], 1)

    // when
    const after = applyKey(state, 'reorder', 4)

    // then
    expect(after.done).toBe(true)
    expect(after.reorder).toBe(true)
    expect(after.chosen).toEqual([1, 0])
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when a key arrives that is not a menu key',
    'it should change nothing, where it used to SUBMIT the menu',
  ].join(' '),
  () => {
    // given
    const state = initialMenu([2], 2)

    // when — `all` with size 0 is the only no-op key left; reorder commits
    const after = applyKey(state, 'none', 4)

    // then
    expect(after.done).toBe(false)
    expect(after.chosen).toEqual([])
  },
)

test(
  [
    'given use-cases/menu::visibleWindow',
    'when every option fits the budget',
    'it should show all of them and scroll nothing',
  ].join(' '),
  () => {
    // given — five one-row options, room for eight
    const costs = [1, 1, 1, 1, 1]

    // when
    const window = visibleWindow(costs, 0, 8)

    // then
    expect(window).toEqual({ start: 0, end: 5 })
  },
)

test(
  [
    'given use-cases/menu::visibleWindow',
    'when the list is longer than the budget and the cursor is near the top',
    'it should start at the top rather than centre the cursor',
  ].join(' '),
  () => {
    // given
    const costs = [1, 1, 1, 1, 1, 1, 1, 1]

    // when
    const window = visibleWindow(costs, 1, 3)

    // then
    expect(window).toEqual({ start: 0, end: 3 })
  },
)

test(
  [
    'given use-cases/menu::visibleWindow',
    'when the cursor moves past the bottom of the window',
    'it should scroll by the least it can, keeping the reader their place',
  ].join(' '),
  () => {
    // given
    const costs = [1, 1, 1, 1, 1, 1, 1, 1]

    // when
    const window = visibleWindow(costs, 3, 3)

    // then
    expect(window).toEqual({ start: 1, end: 4 })
  },
)

test(
  [
    'given use-cases/menu::visibleWindow',
    'when options cost two rows each, as an option with a detail does',
    'it should fit by COST rather than by count',
  ].join(' '),
  () => {
    // given
    const costs = [2, 2, 2, 2]

    // when
    const window = visibleWindow(costs, 0, 5)

    // then
    expect(window).toEqual({ start: 0, end: 2 })
  },
)

test(
  [
    'given use-cases/menu::visibleWindow',
    'when the budget cannot fit even one option',
    'it should still show the one the cursor is on rather than nothing',
  ].join(' '),
  () => {
    // given
    const costs = [3, 3, 3]

    // when
    const window = visibleWindow(costs, 2, 1)

    // then
    expect(window.start).toBeLessThanOrEqual(2)
    expect(window.end).toBeGreaterThan(2)
  },
)

test(
  [
    'given use-cases/menu::visibleWindow',
    'when there are no options at all',
    'it should return an empty window rather than divide by nothing',
  ].join(' '),
  () => {
    // given
    const costs: readonly number[] = []

    // when
    const window = visibleWindow(costs, 0, 10)

    // then
    expect(window).toEqual({ start: 0, end: 0 })
  },
)

test(
  [
    'given use-cases/menu::applyKey',
    'when the "all" key is pressed',
    'it should select every option by index',
  ].join(', '),
  () => {
    // given
    const state = initialMenu([], 0)

    // when
    const after = applyKey(state, 'all', 3)

    // then
    expect(after.chosen).toEqual([0, 1, 2])
  },
)
