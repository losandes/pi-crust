/**
 * The one process boundary in reading pi's model catalogue.
 *
 * Moved out of `pi-agent.ts` so that everything which used to sit behind
 * this spawn can be covered without one: `parseCount` and `catalogRows`
 * parse the text this returns, and `resolveModel` matches against the rows
 * they produce, all of them taking their input as a value now.
 *
 * What no `bun test` process can execute is the spawn itself — it needs a pi
 * install on the machine, which a CI runner does not have and a contributor
 * may not either. Nothing else lives here: no parsing, no matching, no
 * decision of any kind, so an uncovered line in this file is a line that
 * only ran a subprocess.
 */

import { spawnSync } from 'node:child_process'

/**
 * `pi --list-models` stdout, or `undefined` when there is nothing to read.
 *
 * A missing pi, a non-zero exit and a timeout are one answer here — the
 * catalogue could not be read — and what that means is decided by the
 * caller rather than guessed at by the adapter.
 */
export const listModelsOutput = (
  binary: string,
  env: Readonly<Record<string, string>>,
): string | undefined => {
  const result = spawnSync(binary, ['--list-models'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...env },
  })
  return result.status === 0 && typeof result.stdout === 'string'
    ? result.stdout
    : undefined
}
