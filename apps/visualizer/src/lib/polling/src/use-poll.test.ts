import { expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PollIntervalContext } from './poll-interval'
import { type TPoll, usePoll } from './use-poll'

const Probe = ({
  fetcher,
  intervalMs,
  onPoll,
}: Readonly<{
  fetcher: () => Promise<number>
  intervalMs: number | undefined
  onPoll: (poll: TPoll<number>) => void
}>) => {
  onPoll(usePoll(fetcher, 0, intervalMs))
  return undefined
}

const withPoll = async (
  check: (
    hook: Readonly<{
      render: (
        fetcher: () => Promise<number>,
        intervalMs?: number,
        configuredInterval?: number,
      ) => Promise<void>
      current: () => TPoll<number>
      renders: () => number
      unmount: () => Promise<void>
    }>,
  ) => Promise<void>,
  observe: (poll: TPoll<number>) => void = () => undefined,
) => {
  GlobalRegistrator.register()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let latest: TPoll<number> | undefined
  let renders = 0
  let mounted = true
  const onPoll = (poll: TPoll<number>) => {
    latest = poll
    renders += 1
    observe(poll)
  }
  const unmount = async () => {
    if (!mounted) return
    await act(() => root.unmount())
    mounted = false
  }
  try {
    await check({
      render: async (fetcher, intervalMs, configuredInterval = 60_000) => {
        await act(() => {
          root.render(
            createElement(
              PollIntervalContext.Provider,
              { value: configuredInterval },
              createElement(Probe, { fetcher, intervalMs, onPoll }),
            ),
          )
        })
      },
      current: () => {
        if (!latest) throw new Error('Render the hook before reading it')
        return latest
      },
      renders: () => renders,
      unmount,
    })
  } finally {
    await unmount()
    container.remove()
    await GlobalRegistrator.unregister()
  }
}

const until = async (ready: () => boolean) => {
  for (const _ of Array.from({ length: 100 })) {
    if (ready()) return
    await act(async () => {
      await Bun.sleep(10)
    })
  }
  expect(ready()).toBe(true)
}

test(
  [
    'given an unresolved first poll and a refresh before effects run',
    'when the request succeeds',
    'it should replace the initial value and record a successful load time',
  ].join(', '),
  async () => {
    // given
    const pending = Promise.withResolvers<number>()
    const before = Date.now()
    let requests = 0
    let initialRefresh = false
    await withPoll(
      async (hook) => {
        await hook.render(() => {
          requests += 1
          return pending.promise
        })
        expect(hook.current().value).toBe(0)
        expect(hook.current().loaded).toBe(false)
        expect(hook.current().error).toBeUndefined()
        expect(requests).toBe(1)

        // when
        await act(() => pending.resolve(7))

        // then
        expect(hook.current().value).toBe(7)
        expect(hook.current().loaded).toBe(true)
        expect(hook.current().error).toBeUndefined()
        expect(hook.current().at).toBeGreaterThanOrEqual(before)
        expect(hook.current().at).toBeLessThanOrEqual(Date.now())
      },
      (poll) => {
        if (initialRefresh) return
        initialRefresh = true
        poll.refresh()
      },
    )
  },
)

test(
  [
    'given a new fetcher on a subsequent render',
    'when refreshing without restarting the polling interval',
    'it should fetch through the latest dependency',
  ].join(', '),
  async () => {
    // given
    let firstRequests = 0
    let secondRequests = 0
    const first = () => {
      firstRequests += 1
      return Promise.resolve(1)
    }
    const second = () => {
      secondRequests += 1
      return Promise.resolve(2)
    }
    await withPoll(async (hook) => {
      await hook.render(first)
      await hook.render(second)
      expect(hook.current().value).toBe(1)
      expect(secondRequests).toBe(0)

      // when
      await act(() => hook.current().refresh())

      // then
      expect(hook.current().value).toBe(2)
      expect(firstRequests).toBe(1)
      expect(secondRequests).toBe(1)
    })
  },
)

test(
  [
    'given a successful poll followed by a refused request',
    'when a later refresh succeeds',
    'it should retain the last good value during failure and clear the error on recovery',
  ].join(', '),
  async () => {
    // given
    let outcome: number | Error = 1
    const fetcher = () =>
      outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome)
    await withPoll(async (hook) => {
      await hook.render(fetcher)
      const lastSuccess = hook.current().at
      outcome = new Error('offline')

      // when
      await act(() => hook.current().refresh())

      // then
      expect(hook.current().value).toBe(1)
      expect(hook.current().loaded).toBe(true)
      expect(hook.current().at).toBe(lastSuccess)
      expect(hook.current().error).toBe('offline')
      outcome = 3
      await act(() => hook.current().refresh())
      expect(hook.current().value).toBe(3)
      expect(hook.current().error).toBeUndefined()
    })
  },
)

test(
  [
    'given a pending request while interval and refresh ticks arrive',
    'when unmounted before the response resolves',
    'it should avoid overlapping requests and stop updating or polling',
  ].join(', '),
  async () => {
    // given
    const pending = Promise.withResolvers<number>()
    let requests = 0
    const fetcher = () => {
      requests += 1
      return pending.promise
    }
    await withPoll(async (hook) => {
      await hook.render(fetcher, 10)
      await act(async () => {
        hook.current().refresh()
        await Bun.sleep(30)
      })
      expect(requests).toBe(1)
      const renders = hook.renders()

      // when
      await hook.unmount()
      await act(async () => {
        pending.resolve(9)
        await Bun.sleep(30)
      })

      // then
      expect(requests).toBe(1)
      expect(hook.renders()).toBe(renders)
    })
  },
)

for (const explicit of [false, true]) {
  test(
    [
      `given ${explicit ? 'an explicit interval overriding context' : 'a context-provided polling interval'}`,
      'when the scheduled tick runs',
      'it should update the hook with a later response',
    ].join(', '),
    async () => {
      // given
      let requests = 0
      const fetcher = () => Promise.resolve(++requests)
      await withPoll(async (hook) => {
        await hook.render(
          fetcher,
          explicit ? 10 : undefined,
          explicit ? 60_000 : 10,
        )
        expect(hook.current().value).toBe(1)

        // when
        await until(() => hook.current().value >= 2)

        // then
        expect(hook.current().loaded).toBe(true)
        expect(hook.current().error).toBeUndefined()
        expect(requests).toBeGreaterThanOrEqual(2)
      })
    },
  )
}
