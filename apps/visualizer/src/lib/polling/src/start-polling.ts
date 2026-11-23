/** An injected schedule returns the function that cancels the loop. */
export type TEvery = (tick: () => void, ms: number) => () => void

export const everyInterval: TEvery = (tick, ms) => {
  const timer = setInterval(tick, ms)
  return () => clearInterval(timer)
}

export const startPolling = (
  tick: () => void,
  intervalMs: number,
  every: TEvery = everyInterval,
): (() => void) => {
  tick()
  return every(tick, intervalMs)
}
