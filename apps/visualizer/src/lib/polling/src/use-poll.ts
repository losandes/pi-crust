import { errorMessage, settleAsync } from '@typedefs/settlement'
import { useEffect, useRef, useState } from 'react'

export type TPoll<TValue> = Readonly<{
  value: TValue
  error: string | undefined
  loaded: boolean
  /** Wall-clock at the last successful fetch — live durations are measured from it. */
  at: number
  refresh: () => void
}>

/**
 * Poll an endpoint on an interval, without stacking requests.
 *
 * Every live view here does the same four things: fetch, skip the tick if the
 * last one is still in flight, keep the previous value when a fetch fails, and
 * stop on unmount. Written once because getting any of them wrong is invisible
 * until the API is slow, at which point a 500ms interval queues requests
 * faster than the server answers them.
 *
 * A failed poll keeps the last good value on screen deliberately: a run that
 * is mid-flight should not blank out because one request was refused.
 */
export const usePoll = <TValue>(
  fetcher: () => Promise<TValue>,
  initial: TValue,
  intervalMs = 500,
): TPoll<TValue> => {
  const [value, setValue] = useState<TValue>(initial)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [at, setAt] = useState(() => Date.now())
  const inflight = useRef(false)
  const live = useRef(true)
  const latest = useRef(fetcher)
  latest.current = fetcher

  /**
   * `refresh` re-runs the same tick the interval runs, rather than bumping a
   * counter the effect depends on. A counter is a dependency the effect never
   * reads, which tears down and rebuilds the interval to achieve one fetch.
   */
  const tickRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    live.current = true

    const tick = async () => {
      if (inflight.current) return
      inflight.current = true
      // Settles either way, so the in-flight flag clears on one line rather
      // than in a `finally` the rule would report.
      const settled = await settleAsync(() => latest.current())
      inflight.current = false
      if (!live.current) return
      if (settled.status === 'error') {
        setError(errorMessage(settled.error))
        return
      }
      setValue(settled.data)
      setAt(Date.now())
      setError(undefined)
      setLoaded(true)
    }

    tickRef.current = () => void tick()
    void tick()
    const timer = setInterval(() => void tick(), intervalMs)
    return () => {
      live.current = false
      clearInterval(timer)
    }
  }, [intervalMs])

  return { value, error, loaded, at, refresh: () => tickRef.current() }
}
