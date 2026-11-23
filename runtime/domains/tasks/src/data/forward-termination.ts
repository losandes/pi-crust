import { safeParseSettlement } from '../../../../../lib/typedefs'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

type TEvent = (typeof SIGNALS)[number] | 'exit'
type TProcess = Readonly<{
  pid: number
  on: (event: TEvent, listener: () => void) => unknown
  off: (event: TEvent, listener: () => void) => unknown
  listenerCount: (event: TEvent) => number
  kill: (pid: number, signal: NodeJS.Signals) => unknown
}>

export const signalGroup =
  ({ kill }: Pick<TProcess, 'kill'>) =>
  (pid: number | undefined, signal: NodeJS.Signals): void => {
    if (pid !== undefined) safeParseSettlement(() => kill(-pid, signal))
  }

export const forwardTermination =
  (host: TProcess) =>
  (pid: number | undefined): (() => void) => {
    const forward = () => signalGroup(host)(pid, 'SIGTERM')
    const listeners = SIGNALS.map((signal) => {
      const listener = () => {
        forward()
        host.off(signal, listener)
        if (host.listenerCount(signal) === 0) host.kill(host.pid, signal)
      }
      host.on(signal, listener)
      return { signal, listener }
    })
    host.on('exit', forward)
    return () => {
      host.off('exit', forward)
      for (const { signal, listener } of listeners) host.off(signal, listener)
    }
  }
