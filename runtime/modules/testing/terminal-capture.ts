/**
 * Terminal capture for tests: the CLI still prints, the console stays clean.
 *
 * A test that drives `use-cases/report-to-console.ts` — directly, or through
 * `createRun`/`startSession`, which wire the real reporter — makes real
 * `writeLine` calls, and those are the point: print and trace must not drift,
 * so the printing has to happen. What must not happen is 341 lines of banners
 * and boxes landing in the test runner's output, where they hide the failure a
 * reader came for.
 *
 * So the bytes are intercepted at the last possible moment, at
 * `process.stdout.write`, and kept. Everything up to that point — the reporter,
 * the colour codes, the box drawing, the trace event beside each line — runs
 * untouched, and `terminalOutput()` hands the test what a terminal would have
 * shown.
 */

import { spyOn } from 'bun:test'

let chunks: readonly string[] = []
let installed: { readonly mockRestore: () => void } | undefined

/** Start capturing. Idempotent: a second call while installed is a no-op. */
export const silenceTerminal = (): void => {
  if (installed !== undefined) {
    return
  }
  chunks = []
  installed = spyOn(process.stdout, 'write').mockImplementation(
    (chunk: unknown): boolean => {
      chunks = [...chunks, String(chunk)]
      return true
    },
  )
}

/** Put the real stdout back. Safe to call when nothing is installed. */
export const restoreTerminal = (): void => {
  installed?.mockRestore()
  installed = undefined
}

/** Everything written to stdout since the last `silenceTerminal()`. */
export const terminalOutput = (): string => chunks.join('')
