import { useCallback, useEffect, useState } from 'react'
import { type EventRow, fetchEvents } from '@/domains/events'
import { startPolling, usePollInterval } from '@/lib/polling'

/** Drain history once, then tail only while the run is live. */
export const createUseCardEvents =
  (fetchPage: typeof fetchEvents) =>
  (runId: string, running: boolean, workspace: string): readonly EventRow[] => {
    const intervalMs = usePollInterval()
    const [events, setEvents] = useState<readonly EventRow[]>([])

    const createPull = useCallback((runId: string, workspace: string) => {
      // Each effect owns these bindings: a cleaned-up StrictMode pull must not
      // advance the live instance's cursor or block its first request.
      let cursor = 0
      let inflight = false
      let loaded = false
      return async (live: () => boolean) => {
        if (inflight) return
        inflight = true
        try {
          let fresh: readonly EventRow[] = []
          let hasMore = true
          while (hasMore) {
            // Pagination is sequential: each page needs the previous cursor.
            const page = await fetchPage(runId, cursor, 1000, workspace)
            cursor = Math.max(cursor, page.cursor)
            fresh = [...fresh, ...page.events]
            hasMore = page.has_more
          }
          if (!live()) return
          // A new instance re-reads from zero, including the final drain when a
          // run finishes. Replace once so that history cannot be appended twice.
          const replace = !loaded
          loaded = true
          setEvents((previous) =>
            replace
              ? fresh
              : fresh.length > 0
                ? [...previous, ...fresh]
                : previous,
          )
        } catch {
          /* the list view surfaces api errors; a card just retries next poll */
        } finally {
          inflight = false
        }
      }
    }, [])

    useEffect(() => {
      let alive = true
      const live = () => alive
      const tick = createPull(runId, workspace)

      if (!running) {
        void tick(live)
        return () => {
          alive = false
        }
      }

      const stop = startPolling(() => void tick(live), intervalMs)
      return () => {
        alive = false
        stop()
      }
    }, [createPull, runId, running, workspace, intervalMs])

    return events
  }

export const useCardEvents = createUseCardEvents(fetchEvents)
