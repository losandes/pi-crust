import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useRoute } from './use-route'

/*
 * `useRoute` is a one-line `useSyncExternalStore` wrapper around
 * `routeSnapshot`/`subscribeToRoute`, both already covered directly by
 * router.test.ts's own fake-window tests. This proves the wrapper itself
 * does what it says: a component using it sees the route the hash parses to,
 * and re-renders when the hash changes under it.
 */

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const Reader = () => {
  const route = useRoute()
  return createElement(
    'p',
    null,
    `${route.workspace ?? ''}:${route.runId ?? ''}:${route.activityRunId ?? ''}`,
  )
}

test(
  [
    'given useRoute, mounted with the current location hash set',
    'when the hash changes to name a workspace, run and activity run',
    'it should re-render with the newly parsed route',
  ].join(', '),
  async () => {
    // given
    // biome-ignore lint/plugin/no-object-mutation: location.hash is the external seam this test drives; this is the adapter that owns the assignment
    window.location.hash = '#/'
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
    await act(async () => {
      root.render(createElement(Reader))
    })
    expect(container.querySelector('p')?.textContent).toBe('::')

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the re-render the hashchange subscription triggers, not an await in this body
    await act(async () => {
      // biome-ignore lint/plugin/no-object-mutation: location.hash is the external seam this test drives; this is the adapter that owns the assignment
      window.location.hash = '#/alpha:run-9/build'
      window.dispatchEvent(new Event('hashchange'))
    })

    // then
    expect(container.querySelector('p')?.textContent).toBe('alpha:run-9:build')
  },
)
