import { expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { EventRow, fetchEvents } from '@/domains/events'
import { PollIntervalContext } from '@/lib/polling'
import { createUseCardEvents } from './use-card-events'

const event = (rowid: number): EventRow => ({
  rowid,
  event_id: `event-${rowid}`,
  run_id: 'run',
  activity_run_id: 'agent',
  parent_id: '',
  type: 'tool_call',
  name: 'read',
  payload_json: '{}',
  tokens: 0,
  started_at: '2026-11-26T00:00:00Z',
  ended_at: '2026-11-26T00:00:01Z',
})

const response = (events: readonly EventRow[], cursor = 0, hasMore = false) =>
  Promise.resolve({
    events,
    cursor: events.at(-1)?.rowid ?? cursor,
    has_more: hasMore,
  })

const Probe = ({
  running,
  workspace,
  onEvents,
  useEvents,
}: Readonly<{
  running: boolean
  workspace: string
  onEvents: (events: readonly EventRow[]) => void
  useEvents: ReturnType<typeof createUseCardEvents>
}>) => {
  onEvents(useEvents('run', running, workspace))
  return undefined
}

const withHook = async (
  fetchPage: typeof fetchEvents,
  check: (
    hook: Readonly<{
      render: (running: boolean, workspace?: string) => Promise<void>
      events: () => readonly EventRow[]
    }>,
  ) => Promise<void>,
) => {
  GlobalRegistrator.register()
  const useEvents = createUseCardEvents(fetchPage)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let latest: readonly EventRow[] = []
  const onEvents = (events: readonly EventRow[]) => {
    latest = events
  }
  try {
    await check({
      render: async (running, workspace = 'main') => {
        await act(() => {
          root.render(
            createElement(
              StrictMode,
              undefined,
              createElement(
                PollIntervalContext.Provider,
                { value: 10 },
                createElement(Probe, {
                  running,
                  workspace,
                  onEvents,
                  useEvents,
                }),
              ),
            ),
          )
        })
      },
      events: () => latest,
    })
  } finally {
    await act(() => root.unmount())
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
    'given a finished run in StrictMode',
    'when the hook drains paginated history',
    'it should return every event without polling again',
  ].join(', '),
  async () => {
    // given
    const history = [event(1), event(2), event(3)]
    let requests = 0
    await withHook(
      (runId, after, limit, workspace) => {
        requests += 1
        expect(runId).toBe('run')
        expect(workspace).toBe('main')
        expect(limit).toBe(1000)
        return after === 0
          ? response(history.slice(0, 2), 0, true)
          : response(history.slice(2))
      },
      async (hook) => {
        // when
        await hook.render(false)

        // then
        expect(hook.events()).toEqual(history)
        const afterDrain = requests
        await act(async () => {
          await Bun.sleep(30)
        })
        expect(requests).toBe(afterDrain)
      },
    )
  },
)

test(
  [
    'given a running run in StrictMode',
    'when a later poll receives new events',
    'it should append them to the complete history exactly once',
  ].join(', '),
  async () => {
    // given
    let history = [event(1), event(2)]
    await withHook(
      (_, after) =>
        response(
          history.filter((row) => row.rowid > after),
          after,
        ),
      async (hook) => {
        await hook.render(true)
        expect(hook.events()).toEqual(history)

        // when
        history = [...history, event(3)]
        await until(() => hook.events().length === 3)

        // then
        expect(hook.events()).toEqual(history)
      },
    )
  },
)

test(
  [
    'given a running run with committed history',
    'when it finishes before the next live poll',
    'it should replace history with one final full drain without duplicates',
  ].join(', '),
  async () => {
    // given
    let history = [event(1), event(2)]
    await withHook(
      (_, after) =>
        response(
          history.filter((row) => row.rowid > after),
          after,
        ),
      async (hook) => {
        await hook.render(true)
        expect(hook.events()).toEqual(history)
        history = [...history, event(3)]

        // when
        await hook.render(false)

        // then
        expect(hook.events()).toEqual(history)
      },
    )
  },
)

test(
  [
    'given a live pull still in flight',
    'when the run finishes and the old response arrives last',
    'it should retain only the new effect history',
  ].join(', '),
  async () => {
    // given
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof fetchEvents>>>()
    let finished = false
    let requests = 0
    await withHook(
      () => {
        requests += 1
        return finished ? response([event(1), event(2)]) : pending.promise
      },
      async (hook) => {
        await hook.render(true)
        const started = requests
        await act(async () => {
          await Bun.sleep(30)
        })
        expect(requests).toBe(started)

        // when
        finished = true
        await hook.render(false)
        await act(() => pending.resolve(response([event(1)])))

        // then
        expect(hook.events()).toEqual([event(1), event(2)])
      },
    )
  },
)

test(
  [
    'given an API failure on the initial live pull',
    'when a subsequent poll succeeds',
    'it should recover the history and tolerate empty later pages',
  ].join(', '),
  async () => {
    // given
    let available = false
    let emptyPages = 0
    await withHook(
      (_, after) => {
        if (!available) return Promise.reject(new Error('offline'))
        if (after > 0) emptyPages += 1
        return response(after === 0 ? [event(1)] : [], after)
      },
      async (hook) => {
        await hook.render(true)
        expect(hook.events()).toEqual([])

        // when
        available = true
        await until(() => emptyPages > 0)

        // then
        expect(hook.events()).toEqual([event(1)])
      },
    )
  },
)

test(
  [
    'given events from one workspace',
    'when the workspace changes to an empty finished run',
    'it should clear the previous history even when the first page is empty',
  ].join(', '),
  async () => {
    // given
    await withHook(
      (_, _after, _limit, workspace) =>
        response(workspace === 'main' ? [event(1)] : []),
      async (hook) => {
        await hook.render(false)
        expect(hook.events()).toEqual([event(1)])

        // when
        await hook.render(false, 'other')

        // then
        expect(hook.events()).toEqual([])
      },
    )
  },
)
