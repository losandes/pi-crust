/**
 * What order hand-picked steps run in, and which the menu offers at all.
 *
 * Picking steps used to mean picking them IN ORDER: the menu recorded the
 * sequence you tabbed them in, so getting the ordinary lifecycle sequence
 * required ticking nine boxes in exactly the right order, and pressing `a`
 * for all produced a different rule — list order — from the same screen.
 * Two orderings from one menu, neither of them stated.
 *
 * Now selection is a set, and order is a separate, stated thing: the order
 * `crust.activities.yaml` declares, with an explicit reorder for the runs
 * where it matters. The canonical order is the registry's own, because the
 * registry is the only thing that records a sequence — so nothing else can
 * drift out of step with the Activities that exist.
 */

/**
 * Sort a selection into the running order.
 *
 * A step the order does not know about goes last rather than being dropped —
 * losing a step somebody ticked would be a silently shorter chain, which is
 * the one failure this whole area keeps producing.
 */
export const orderSteps = (
  selected: readonly string[],
  order: readonly string[],
): readonly string[] => {
  const rank = new Map(order.map((name, index) => [name, index]))
  return [...selected].toSorted(
    (a, b) =>
      (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
}

/**
 * The steps a menu offers: everything, minus what the config hides.
 *
 * HIDDEN, not disabled. A hidden step is out of the way of somebody who
 * drives the factory with lifecycles or an operator; it is not forbidden,
 * and a lifecycle, an operator or an explicit `--steps` still runs it. The
 * difference matters: hiding is a preference, and disabling `code-review`
 * would be one developer quietly running a shorter chain than everyone else.
 */
export const visibleSteps = (
  all: readonly string[],
  hidden: readonly string[] = [],
): readonly string[] => {
  const out = new Set(hidden)
  return all.filter((name) => !out.has(name))
}

/**
 * Move one item within a list, returning a new list.
 *
 * Clamped rather than wrapped: an item at the top that keeps being pushed up
 * should stay at the top. Wrapping here would teleport a step from first to
 * last on a keypress somebody was holding down.
 */
export const moveItem = <T>(
  items: readonly T[],
  index: number,
  delta: number,
): readonly T[] => {
  const target = index + delta
  if (index < 0 || index >= items.length) return items
  if (target < 0 || target >= items.length) return items
  const moving = items[index]
  if (moving === undefined) return items
  const without = items.filter((_, position) => position !== index)
  return [...without.slice(0, target), moving, ...without.slice(target)]
}
