import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BUILTIN_THEMES, type TRegisteredTheme } from './registered'
import { themesUrl, useRegisteredThemes } from './use-registered-themes'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let originalFetch: typeof fetch

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = originalFetch
})

originalFetch = globalThis.fetch

const mountHook = async (
  workspace: string | undefined,
): Promise<{
  root: Root
  container: HTMLDivElement
  latest: () => readonly TRegisteredTheme[]
}> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let latest: readonly TRegisteredTheme[] = BUILTIN_THEMES

  const Probe = () => {
    latest = useRegisteredThemes(workspace)
    return null
  }

  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the effect this mount triggers
  await act(async () => {
    root.render(createElement(Probe))
  })

  return { root, container, latest: () => latest }
}

test(
  [
    'given theme::themesUrl',
    'when no workspace is given',
    'it should request the unscoped endpoint',
  ].join(', '),
  () => {
    // given / when
    const actual = themesUrl(undefined)

    // then
    expect(actual).toBe('/api/themes')
  },
)

test(
  [
    'given theme::themesUrl',
    'when a workspace label is given',
    'it should scope the request to it',
  ].join(', '),
  () => {
    // given / when
    const actual = themesUrl('my-tree')

    // then
    expect(actual).toBe('/api/themes?workspace=my-tree')
  },
)

test(
  [
    'given theme::themesUrl',
    'when the label needs URL encoding',
    'it should encode it rather than splitting the query string',
  ].join(', '),
  () => {
    // given / when
    const actual = themesUrl('feat/crust agent')

    // then
    expect(actual).toBe('/api/themes?workspace=feat%2Fcrust%20agent')
  },
)

test(
  [
    'given theme::useRegisteredThemes',
    'when the request has not resolved yet',
    'it should render the builtin themes so the picker is never empty',
  ].join(', '),
  async () => {
    // given — pending forever is fine for this assertion; mounting is enough
    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = (() =>
      new Promise(() => undefined)) as unknown as typeof fetch

    // when / then — synchronous read, before any effect has settled
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let latest: readonly TRegisteredTheme[] = []
    const Probe = () => {
      latest = useRegisteredThemes(undefined)
      return null
    }
    act(() => {
      root.render(createElement(Probe))
    })
    expect(latest).toBe(BUILTIN_THEMES)
    await act(() => {
      root.unmount()
    })
  },
)

test(
  [
    'given theme::useRegisteredThemes',
    'when the server returns a registered theme list',
    'it should replace the builtins with it',
  ].join(', '),
  async () => {
    // given
    const served: readonly TRegisteredTheme[] = [
      { name: 'auto', label: 'Match the system', builtin: true, css: '' },
      { name: 'midnight', label: 'Midnight', builtin: false, css: ':root{}' },
    ]
    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ themes: served }), {
        status: 200,
      })) as unknown as typeof fetch

    // when
    const { latest, root } = await mountHook('feature-a')

    // then
    expect(latest()).toEqual(served)
    await act(() => {
      root.unmount()
    })
  },
)

test(
  [
    'given theme::useRegisteredThemes',
    'when the server reports a registration problem',
    'it should warn, but keep whatever theme list it already has',
  ].join(', '),
  async () => {
    // given
    let warnings: readonly (readonly unknown[])[] = []
    const originalWarn = console.warn
    // biome-ignore lint/plugin/no-object-mutation: console.warn is the external seam this test stubs to observe the hook's deliberate warning; this is the adapter that owns the assignment
    console.warn = (...args: unknown[]) => {
      warnings = [...warnings, args]
    }
    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ problem: 'crust.observe.yaml: bad theme' }),
        {
          status: 200,
        },
      )) as unknown as typeof fetch

    // when
    const { latest, root } = await mountHook(undefined)

    // then
    expect(latest()).toBe(BUILTIN_THEMES)
    expect(warnings.some((args) => String(args[0]).includes('bad theme'))).toBe(
      true,
    )
    // biome-ignore lint/plugin/no-object-mutation: restoring the real console.warn after the capture
    console.warn = originalWarn
    await act(() => {
      root.unmount()
    })
  },
)

test(
  [
    'given theme::useRegisteredThemes',
    'when the response is not ok, or the fetch itself rejects',
    'it should fail soft and keep the builtins',
  ].join(', '),
  async () => {
    // given — a styling fault is not a reason to surface an error over a trace
    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = (async () =>
      new Response('', { status: 500 })) as unknown as typeof fetch
    const notOk = await mountHook(undefined)
    expect(notOk.latest()).toBe(BUILTIN_THEMES)
    await act(() => {
      notOk.root.unmount()
    })

    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = (() =>
      Promise.reject(new Error('network down'))) as unknown as typeof fetch
    const rejected = await mountHook(undefined)
    expect(rejected.latest()).toBe(BUILTIN_THEMES)
    await act(() => {
      rejected.root.unmount()
    })
  },
)

test(
  [
    'given theme::useRegisteredThemes',
    'when the route changes to a different workspace',
    'it should abort the in-flight request for the old one',
  ].join(', '),
  async () => {
    // given
    let aborted = false
    // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
    globalThis.fetch = ((_: unknown, init?: RequestInit) => {
      const signal = init?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }) as unknown as typeof fetch

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Probe = ({ workspace }: { workspace: string }) => {
      useRegisteredThemes(workspace)
      return null
    }
    // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the effect each render triggers
    await act(async () => {
      root.render(createElement(Probe, { workspace: 'a' }))
    })
    // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the effect each render triggers
    await act(async () => {
      root.render(createElement(Probe, { workspace: 'b' }))
    })

    // then
    expect(aborted).toBe(true)
    await act(() => {
      root.unmount()
    })
  },
)
