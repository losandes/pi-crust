import { afterEach, expect, test } from 'bun:test'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from './terminal-capture'

afterEach(() => {
  restoreTerminal()
})

test(
  [
    'given testing/terminal-capture::silenceTerminal and terminalOutput',
    'when stdout is written to while capturing',
    'it should hold what was written without it reaching the real terminal',
  ].join(', '),
  () => {
    // given
    silenceTerminal()

    // when
    process.stdout.write('hello ')
    process.stdout.write('world')

    // then
    expect(terminalOutput()).toBe('hello world')
  },
)

test(
  [
    'given testing/terminal-capture::silenceTerminal',
    'when called a second time while already installed',
    'it should be a no-op, keeping the capture already in progress',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    process.stdout.write('first')

    // when — a second call must not reset what has already been captured
    silenceTerminal()
    process.stdout.write(' second')

    // then
    expect(terminalOutput()).toBe('first second')
  },
)

test(
  [
    'given testing/terminal-capture::restoreTerminal',
    'when nothing has been installed',
    'it should do nothing, rather than throw',
  ].join(', '),
  () => {
    // given — no prior silenceTerminal() call
    const act = () => restoreTerminal()

    // then
    expect(act).not.toThrow()
  },
)

test(
  [
    'given testing/terminal-capture::restoreTerminal',
    'when capture is stopped and then resumed',
    'it should start a fresh capture, not append to the old one',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    process.stdout.write('first run')
    restoreTerminal()

    // when
    silenceTerminal()
    process.stdout.write('second run')

    // then
    expect(terminalOutput()).toBe('second run')
  },
)
