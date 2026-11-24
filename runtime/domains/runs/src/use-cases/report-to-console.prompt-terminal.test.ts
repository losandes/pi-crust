import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { TTracer } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../../../../testing/terminal-capture'
import {
  createConsole,
  PROMPT_BODY_CHARS,
  PROMPT_BODY_LINES,
} from './report-to-console'

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

/*
 * Independent, additional coverage for
 * https://github.com/losandes/pi-crust/issues/39, beyond what
 * `report-to-console.test.ts` (written by the build stage) already covers.
 *
 * That file proves the TRACED copy of `promptReceived` is always the whole,
 * untruncated prompt (its "60 identical lines" and "embedded quote" tests
 * both assert against the tracer's recorded messages). None of its
 * assertions touch `writeLine` / `process.stdout.write` — the actual
 * terminal destination a person reads at `crust run` time. The issue's
 * success criteria are about what is printed to the TERMINAL ("the person
 * sees the mangled text ... which is checkable without reading source"),
 * and `report-to-console.ts`'s own doc comment draws a line between the two
 * destinations: "How much of a prompt the TERMINAL shows. The traced copy
 * is never cut." These tests exercise that line directly, by spying on
 * `process.stdout.write`, so a change that collapsed the two destinations
 * back into one (e.g. printing the full prompt to the terminal, or
 * truncating the trace) would be caught here even though it would leave
 * `report-to-console.test.ts` green.
 */

/** A tracer that records every `message` a console emitted, as plain text. */
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
    'when promptReceived is called with a prompt longer than PROMPT_BODY_LINES/PROMPT_BODY_CHARS',
    'it should print a terminal line that stops short of the full prompt, while the trace keeps it whole',
  ].join(', '),
  () => {
    // given
    const { tracer, messages } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const line = 'x'.repeat(100)
    const prompt = Array.from({ length: 60 }, () => line).join('\n')
    expect(prompt.split('\n').length).toBeGreaterThan(PROMPT_BODY_LINES)
    expect(prompt.length).toBeGreaterThan(PROMPT_BODY_CHARS)

    // when
    console_.promptReceived(prompt)
    const terminal = terminalOutput()

    // then — the terminal never receives the whole prompt as one substring
    expect(terminal.includes(prompt)).toBe(false)
    // and it tells the reader there is more, and where to find it
    expect(terminal).toContain('more characters')
    expect(terminal).toContain('trace')
    // while the traced copy, as `report-to-console.test.ts` already
    // established, is the whole thing
    expect(messages.some((entry) => entry.includes(prompt))).toBe(true)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when promptReceived is called with a prompt within PROMPT_BODY_LINES/PROMPT_BODY_CHARS',
    'it should print the whole prompt to the terminal, with no elision notice',
  ].join(', '),
  () => {
    // given
    const { tracer } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const prompt = 'fix the login bug\nand add a test for it'

    // when
    console_.promptReceived(prompt)
    const terminal = terminalOutput()

    // then — short enough that nothing is cut, so the terminal shows it all
    expect(terminal).toContain('fix the login bug')
    expect(terminal).toContain('and add a test for it')
    expect(terminal).not.toContain('more characters')
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when promptReceived is called with an embedded double quote and a backtick',
    'it should print those exact characters to the terminal, unmangled a second time',
  ].join(', '),
  () => {
    // given — the shell already had its chance to mangle this string before
    // the process ever saw it; the terminal must not mangle it again
    const { tracer } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')
    const prompt = 'say "hello" then run `rm -rf /`'

    // when
    console_.promptReceived(prompt)
    const terminal = terminalOutput()

    // then
    expect(terminal).toContain(prompt)
  },
)

test(
  [
    'given use-cases/report-to-console::createConsole',
    'when promptReceived is called with an empty string',
    'it should print a header reporting 0 chars, with no body lines or elision notice',
  ].join(', '),
  () => {
    // given
    const { tracer } = tracedMessages()
    const console_ = createConsole(tracer, 'aaaa1111')

    // when
    console_.promptReceived('')
    const terminal = terminalOutput()

    // then
    expect(terminal).toContain('0 chars')
    expect(terminal).not.toContain('more characters')
  },
)
