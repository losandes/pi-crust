import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  hrefFor,
  navigate,
  parseHash,
  routeSnapshot,
  subscribeToRoute,
} from './router'

const makeWindow = (hash: string) => {
  const listeners = new Map<string, Set<() => void>>()
  return {
    location: { hash },
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  }
}

let originalWindow: unknown

beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window
})

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
  ;(globalThis as { window?: unknown }).window = originalWindow
})

test(
  [
    'given lib/router::parseHash',
    'when the link predates workspaces',
    'it should still mean the run it always meant',
  ].join(', '),
  () => {
    // given — bookmarks, pasted links and anything a developer typed. A
    // routing change that invalidates them is a routing change that loses
    // people their open tabs.
    const old = '#/c35f2c7d/c35f2c7d_03_design'

    // when
    const actual = parseHash(old)

    // then
    expect(actual).toEqual({
      runId: 'c35f2c7d',
      activityRunId: 'c35f2c7d_03_design',
      workspace: undefined,
    })
  },
)

test(
  [
    'given lib/router::parseHash',
    'when the link names a workspace',
    'it should read both, and keep the activityRun in the second segment',
  ].join(', '),
  () => {
    // given — a colon rather than another slash, so the activityRun id does not
    // slide along depending on whether a workspace precedes it
    const link = '#/feature-a:c35f2c7d/c35f2c7d_03_design'

    // when
    const actual = parseHash(link)

    // then
    expect(actual).toEqual({
      runId: 'c35f2c7d',
      activityRunId: 'c35f2c7d_03_design',
      workspace: 'feature-a',
    })
  },
)

test(
  [
    'given lib/router::hrefFor',
    'when a workspace is known and when it is not',
    'it should address the run exactly once either way',
  ].join(', '),
  () => {
    // given — an unqualified link is a complete address on its own: the
    // server finds the run across every tree it watches
    const cases = [
      hrefFor('c35f2c7d'),
      hrefFor('c35f2c7d', 'p1'),
      hrefFor('c35f2c7d', undefined, 'feature-a'),
      hrefFor('c35f2c7d', 'p1', 'feature-a'),
      hrefFor('c35f2c7d', 'p1', ''),
      hrefFor(),
    ]

    // when
    const actual = cases

    // then
    expect(actual).toEqual([
      '#/c35f2c7d',
      '#/c35f2c7d/p1',
      '#/feature-a:c35f2c7d',
      '#/feature-a:c35f2c7d/p1',
      '#/c35f2c7d/p1',
      '#/',
    ])
  },
)

test(
  [
    'given lib/router::hrefFor and parseHash',
    'when a label or id contains a character that needs escaping',
    'it should survive the round trip',
  ].join(', '),
  () => {
    // given — labels are slugified server-side, but nothing stops a hand
    // typed link, and a half-escaped one routes somewhere unintended
    const href = hrefFor('run/one', 'activityRun one', 'tree:two')

    // when
    const actual = parseHash(href)

    // then — the workspace splits at the FIRST colon, which is the delimiter
    expect(actual).toEqual({
      workspace: 'tree',
      runId: 'two:run/one',
      activityRunId: 'activityRun one',
    })
  },
)

test(
  [
    'given lib/router::navigate',
    'when asked to go to a run',
    'it should set the hash to the link that addresses it',
  ].join(', '),
  () => {
    // given
    const win = makeWindow('')
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = win

    // when
    navigate('c35f2c7d', 'p1', 'feature-a')

    // then
    expect(win.location.hash).toBe('#/feature-a:c35f2c7d/p1')
  },
)

test(
  [
    'given lib/router::routeSnapshot',
    'when the hash has not changed since the last read',
    'it should return the same cached snapshot',
  ].join(', '),
  () => {
    // given — identity matters because useSyncExternalStore compares by it
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = makeWindow('#/run-a')

    // when
    const first = routeSnapshot()
    const second = routeSnapshot()

    // then
    expect(first).toBe(second)
  },
)

test(
  [
    'given lib/router::routeSnapshot',
    'when the hash changes between reads',
    'it should parse the new hash rather than reusing the cache',
  ].join(', '),
  () => {
    // given
    const win = makeWindow('#/run-a')
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = win

    // when
    routeSnapshot()
    // biome-ignore lint/plugin/no-object-mutation: the fake window's location is the external seam this test drives; this is the adapter that owns the assignment
    win.location.hash = '#/run-b'
    const actual = routeSnapshot()

    // then
    expect(actual.runId).toBe('run-b')
  },
)

test(
  [
    'given lib/router::subscribeToRoute',
    'when subscribing and then unsubscribing',
    'it should register on hashchange and remove itself on cleanup',
  ].join(', '),
  () => {
    // given
    const win = makeWindow('')
    // biome-ignore lint/plugin/no-object-mutation: globalThis.window is the external seam these tests stub; this is the adapter that owns the assignment
    ;(globalThis as { window?: unknown }).window = win
    const onChange = () => undefined

    // when
    const unsubscribe = subscribeToRoute(onChange)

    // then
    expect(win.listenerCount('hashchange')).toBe(1)

    // when
    unsubscribe()

    // then
    expect(win.listenerCount('hashchange')).toBe(0)
  },
)
