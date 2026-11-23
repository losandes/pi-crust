import { expect, test } from 'bun:test'
import { forwardTermination } from './forward-termination'

test(
  [
    'given listeners forwarded to a child group and a pre-existing termination handler',
    'when the host gets signals and the task detaches its listeners',
    'it should terminate the group and resend only unhandled signals to the host',
  ].join(', '),
  () => {
    // given
    const listeners = new Map<string, Set<() => void>>([
      ['SIGTERM', new Set([() => undefined])],
    ])
    const sent: [number, NodeJS.Signals][] = []
    const done = forwardTermination({
      pid: 9,
      on: (event, listener) =>
        listeners.set(
          event,
          new Set([...(listeners.get(event) ?? []), listener]),
        ),
      off: (event, listener) => listeners.get(event)?.delete(listener),
      listenerCount: (event) => listeners.get(event)?.size ?? 0,
      // biome-ignore lint/plugin/no-array-mutation: capture signal delivery in order
      kill: (pid, signal) => sent.push([pid, signal]),
    })(3)
    // when
    for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit']) {
      for (const listener of listeners.get(event) ?? []) listener()
    }
    done()
    // then
    expect(sent).toEqual([
      [-3, 'SIGTERM'],
      [9, 'SIGINT'],
      [-3, 'SIGTERM'],
      [-3, 'SIGTERM'],
      [9, 'SIGHUP'],
      [-3, 'SIGTERM'],
    ])
    expect([...listeners].map(([name, set]) => [name, set.size])).toEqual([
      ['SIGTERM', 1],
      ['SIGINT', 0],
      ['SIGHUP', 0],
      ['exit', 0],
    ])
  },
)
