import { expect, test } from 'bun:test'

/**
 * The cursor race, reproduced without React.
 *
 * `useTrace` kept its paging cursor in a ref, so two effect instances — which
 * is what StrictMode mounts in development — shared one cursor and one
 * in-flight flag. This exercises the same shape: the bookkeeping must belong
 * to the instance that created it, or a finished run's events are fetched by a
 * poller that then discards them, leaving the live poller asking for events
 * after a cursor nothing will ever follow.
 */
type Bookkeeping = { readonly cursor: number; readonly inflight: boolean }

type Shared = {
  readonly read: () => Bookkeeping
  readonly update: (next: (prev: Bookkeeping) => Bookkeeping) => void
}

/**
 * The bookkeeping a ref held, behind read and update so each step builds the
 * next value rather than editing the one it was given.
 */
const bookkeeping = (initial: Bookkeeping): Shared => {
  let state = initial
  return {
    read: () => state,
    update: (next) => {
      state = next(state)
    },
  }
}

const makePoller = (
  state: Shared,
  pages: ReadonlyMap<number, readonly number[]>,
) => {
  let collected: readonly number[] = []
  const tick = async (live: () => boolean): Promise<readonly number[]> => {
    if (state.read().inflight) return collected
    state.update((prev) => ({ ...prev, inflight: true }))
    try {
      await Promise.resolve()
      const page = pages.get(state.read().cursor) ?? []
      state.update((prev) => ({ ...prev, cursor: prev.cursor + page.length }))
      if (!live()) return collected
      collected = [...collected, ...page]
      return collected
    } finally {
      state.update((prev) => ({ ...prev, inflight: false }))
    }
  }
  return { tick, collected: () => collected }
}

const PAGES = new Map<number, readonly number[]>([[0, [1, 2, 3]]])

test(
  [
    'given lib/use-trace::the poll cursor',
    "when a second mount shares the first mount's cursor",
    'it should be able to lose every event of a finished run',
  ].join(', '),
  async () => {
    // given — one piece of shared bookkeeping, as refs made it
    const shared = bookkeeping({ cursor: 0, inflight: false })
    const first = makePoller(shared, PAGES)
    const second = makePoller(shared, PAGES)

    // when — the first mount starts, is torn down, and the second takes over
    const firstRun = first.tick(() => false)
    const secondRun = second.tick(() => true)
    await firstRun
    await secondRun

    // then — the first advanced the cursor and threw its results away, so the
    // second polls past the end and the UI shows a activityRun with no events
    expect(second.collected()).toEqual([])
    expect(shared.read().cursor).toBe(3)
  },
)

test(
  [
    'given lib/use-trace::the poll cursor',
    'when each mount owns its cursor',
    'it should see every event of a finished run',
  ].join(', '),
  async () => {
    // given — bookkeeping created per instance, as the hook now does
    const first = makePoller(bookkeeping({ cursor: 0, inflight: false }), PAGES)
    const second = makePoller(
      bookkeeping({ cursor: 0, inflight: false }),
      PAGES,
    )

    // when
    const firstRun = first.tick(() => false)
    const secondRun = second.tick(() => true)
    await firstRun
    await secondRun

    // then
    expect(second.collected()).toEqual([1, 2, 3])
  },
)
