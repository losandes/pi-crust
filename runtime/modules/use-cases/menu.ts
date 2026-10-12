/**
 * The state behind an arrow-key menu, with no terminal anywhere near it.
 *
 * Key handling looks too trivial to test until a list wraps at the wrong end,
 * or tab deselects the last remaining choice and enter submits nothing. Those
 * are the bugs a menu actually has, and they are ordinary state transitions —
 * so the transitions live here as a function from state and key to state, and
 * the TTY module below only decodes bytes and draws.
 */

export type TMenuState = Readonly<{
  /** Where the cursor is. Always a valid index while there is anything to show. */
  cursor: number
  /** Indices chosen so far. Ordered by selection, not by position. */
  chosen: readonly number[]
  /** Set once the person commits; the caller stops reading keys. */
  done: boolean
  /** Set when they back out. Distinct from done with nothing chosen. */
  cancelled: boolean
  /**
   * Set when they committed the selection AND asked to order it by hand.
   *
   * Separate from `done` rather than a third terminal state, because the
   * selection is finished either way — what differs is only whether another
   * question follows.
   */
  reorder: boolean
}>

/** The keys a menu understands, already decoded from bytes. */
export type TMenuKey =
  | 'up'
  | 'down'
  | 'toggle'
  | 'submit'
  | 'cancel'
  | 'all'
  | 'none'
  | 'reorder'
  /** j / k. A menu reads them as the cursor; the ordering screen moves the
   * activity with them, because there the arrows already move the cursor and a
   * shift chord to reorder is a chord nobody should have to hold. */
  | 'vimDown'
  | 'vimUp'

export const initialMenu = (
  chosen: readonly number[] = [],
  cursor = 0,
): TMenuState => ({
  cursor,
  chosen,
  done: false,
  cancelled: false,
  reorder: false,
})

/**
 * Wraps at both ends.
 *
 * A list of four options where `up` at the top does nothing makes the last
 * option the most expensive one to reach, which is backwards — it is the one
 * furthest from the default and so the one being deliberately chosen.
 */
const move = (cursor: number, delta: number, size: number): number =>
  size === 0 ? 0 : (cursor + delta + size) % size

/**
 * Selection is ordered by WHEN it was chosen, not by position in the list.
 *
 * For a activity chain that is the whole point: picking `build` and then `plan`
 * means plan-after-build, which is a different run from the other order.
 */
const toggle = (chosen: readonly number[], index: number): readonly number[] =>
  chosen.includes(index)
    ? chosen.filter((each) => each !== index)
    : [...chosen, index]

export const applyKey = (
  state: TMenuState,
  key: TMenuKey,
  size: number,
): TMenuState => {
  if (state.done || state.cancelled) return state
  if (key === 'up' || key === 'vimUp') {
    return { ...state, cursor: move(state.cursor, -1, size) }
  }
  if (key === 'down' || key === 'vimDown') {
    return { ...state, cursor: move(state.cursor, 1, size) }
  }
  if (key === 'toggle') {
    return { ...state, chosen: toggle(state.chosen, state.cursor) }
  }
  if (key === 'all') {
    return { ...state, chosen: Array.from({ length: size }, (_, i) => i) }
  }
  if (key === 'none') return { ...state, chosen: [] }
  if (key === 'cancel') return { ...state, cancelled: true }
  // Reorder COMMITS the selection and asks for one more question. Treating
  // it as a separate terminal state would mean every caller handled three.
  if (key === 'reorder') return { ...state, done: true, reorder: true }
  if (key === 'submit') return { ...state, done: true }
  /*
   * Anything else changes nothing. This used to be `return { done: true }`,
   * which meant a key this menu does not use — the item-move keys, now that
   * they exist — would have SUBMITTED it.
   */
  return state
}

/**
 * Some choices cannot be combined, and the menu has to say so by behaving.
 *
 * A lifecycle and a hand-picked list of activities are two ways of answering the
 * same question, not two things you add together. With `sdlc` preselected and
 * tab the only way off it, picking `scout` APPENDED scout to the whole
 * lifecycle — the run that was meant to be one agent call ran nine and then
 * scouted. Nothing on screen said the default was still held.
 *
 * So choosing an exclusive option clears everything else, and choosing any
 * other option clears the exclusives. Selecting a thing means you want that
 * thing; it should never be the second half of a sentence you did not start.
 */
export const applyExclusiveKey = (
  state: TMenuState,
  key: TMenuKey,
  size: number,
  exclusive: readonly number[],
): TMenuState => {
  if (key !== 'toggle' && key !== 'all') return applyKey(state, key, size)
  if (key === 'all') {
    // "all" means all the ordinary options; taking every lifecycle as well
    // would be a contradiction the menu has to resolve anyway.
    return {
      ...state,
      chosen: Array.from({ length: size }, (_, i) => i).filter(
        (i) => !exclusive.includes(i),
      ),
    }
  }
  const here = state.cursor
  if (exclusive.includes(here)) {
    return { ...state, chosen: state.chosen.includes(here) ? [] : [here] }
  }
  const withoutExclusives = state.chosen.filter(
    (index) => !exclusive.includes(index),
  )
  return {
    ...state,
    chosen: withoutExclusives.includes(here)
      ? withoutExclusives.filter((index) => index !== here)
      : [...withoutExclusives, here],
  }
}

/**
 * Enter on a single-choice menu means "this one", whatever the cursor is on.
 *
 * Typing arrow-arrow-enter and getting nothing because you never pressed tab
 * is the single most annoying thing a menu can do.
 */
export const applySingleKey = (
  state: TMenuState,
  key: TMenuKey,
  size: number,
): TMenuState => {
  if (key !== 'submit') return applyKey(state, key, size)
  return { ...state, chosen: [state.cursor], done: true }
}

/** What was chosen, in selection order, mapped back onto the options. */
export const selected = <T>(
  options: readonly T[],
  state: TMenuState,
): readonly T[] =>
  state.chosen
    .map((index) => options[index])
    .filter((option): option is T => option !== undefined)

/**
 * Which slice of a long list to show, so the frame fits the terminal.
 *
 * A menu taller than the viewport cannot be redrawn in place: erasing it
 * means moving the cursor up by its height, and the cursor cannot go above
 * the top of the screen — so every keypress leaves the previous frame
 * stranded above the new one. The menu grew past that point the day seven
 * activities and an operator row were added, and the symptom was a screen filling
 * with copies of itself.
 *
 * Costs are per option, because an option with a detail line is two rows.
 * The window always contains the cursor, prefers to start at the top while
 * that fits, and otherwise scrolls by as little as it can.
 */
export const visibleWindow = (
  costs: readonly number[],
  cursor: number,
  budget: number,
): Readonly<{ start: number; end: number }> => {
  if (costs.length === 0 || budget <= 0) return { start: 0, end: 0 }

  /**
   * How far forward we can reach from `start` without exceeding the budget.
   *
   * Carries a running total rather than collecting the costs it took: the
   * list is every activity the factory has, and rebuilding an array per option
   * would make drawing a menu quadratic in the thing being drawn.
   */
  const reachFrom = (start: number): number =>
    costs.slice(start).reduce<Readonly<{ used: number; count: number }>>(
      (acc, cost) =>
        acc.used + cost <= budget
          ? { used: acc.used + cost, count: acc.count + 1 }
          : acc,
      { used: 0, count: 0 },
    ).count + start

  const fromTop = reachFrom(0)
  if (cursor < fromTop) return { start: 0, end: Math.max(fromTop, cursor + 1) }

  /*
   * Scroll the minimum: find the earliest start whose reach still covers the
   * cursor. Walking forward rather than guessing keeps the list steady —
   * jumping the window by a page would lose the reader's place.
   */
  const starts = costs.map((_, index) => index)
  const start =
    starts.find((candidate) => reachFrom(candidate) > cursor) ?? cursor
  return { start, end: Math.max(reachFrom(start), cursor + 1) }
}
