import { expect, test } from 'bun:test'
import type { TTracer } from '../typedefs/trace'
import { createConsole } from './report-to-console'

/** A tracer that records every `message` the console emitted, as plain text. */
const tracedMessages = (): Readonly<{
  tracer: TTracer
  messages: string[]
}> => {
  const messages: string[] = []
  const tracer = {
    event: (
      input: Readonly<{ payload?: Readonly<Record<string, unknown>> }>,
    ) => {
      const message = input.payload?.message
      if (typeof message === 'string') {
        // biome-ignore lint/plugin/no-array-mutation: recording what was emitted is the test
        messages.push(message)
      }
      return ''
    },
  } as unknown as TTracer

  return { tracer, messages }
}

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when the workspace root and the VCS root differ',
    'it should print both, named, in the start-of-run banner (1.5.1)',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.sessionStarted('aaaa1111', 'tester', '/repo/_newstack', '/repo')

    // then
    expect(messages.some((line) => line.includes('/repo/_newstack'))).toBe(true)
    expect(messages.some((line) => line.includes('/repo'))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when the workspace root equals the VCS root',
    'it should print the banner exactly as before this spec \u2014 no root line at all (1.5.3, 1.6.2)',
  ].join(', '),
  () => {
    // given — the ordinary, unnested case
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.sessionStarted('aaaa1111', 'tester', '/repo', '/repo')

    // then — the one banner line, nothing naming a second root
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('run_id:')
  },
)
