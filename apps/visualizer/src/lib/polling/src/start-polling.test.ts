import { expect, test } from 'bun:test'
import { everyInterval, startPolling, type TEvery } from './start-polling'

test(
  [
    'given @SC19 an injected recording schedule',
    'when polling starts',
    'it should tick once, schedule that same tick at the chosen delay and return the scheduler cancellation',
  ].join(', '),
  () => {
    // given
    let calls: readonly string[] = []
    const tick = () => {
      calls = [...calls, 'tick']
    }
    const cancel = () => {
      calls = [...calls, 'cancel']
    }
    let scheduled: readonly Readonly<{ tick: () => void; ms: number }>[] = []
    const every: TEvery = (callback, ms) => {
      calls = [...calls, 'schedule']
      scheduled = [...scheduled, { tick: callback, ms }]
      return cancel
    }
    // when
    const stop = startPolling(tick, 250, every)
    // then
    expect(calls).toEqual(['tick', 'schedule'])
    expect(scheduled).toEqual([{ tick, ms: 250 }])
    expect(stop).toBe(cancel)
    scheduled[0]?.tick()
    stop()
    expect(calls).toEqual(['tick', 'schedule', 'tick', 'cancel'])
  },
)

test(
  [
    'given the real interval adapter',
    'when cancelled synchronously before the event loop can tick',
    'it should have invoked no callback and should return a usable cancellation',
  ].join(', '),
  () => {
    // given
    let calls: readonly string[] = []
    const tick = () => {
      calls = [...calls, 'tick']
    }
    // when
    const stop = everyInterval(tick, 250)
    stop()
    const beforeDefault = calls
    const cancelDefault = startPolling(tick, 250)
    cancelDefault()
    // then
    expect(beforeDefault).toEqual([])
    expect(calls).toEqual(['tick'])
  },
)
