/** A gate that makes a command answer for an envelope's claim. */

import { spawnSync } from 'node:child_process'
import { operatorEnv } from '../../data/operator-env'
import type { TGate } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'

/** command output kept as evidence on a failure */
export const TAIL_CHARS = 1000

/**
 * Gate factory: the given command must exit 0.
 *
 * argv LIST, never a shell string — no quoting bugs, no shell injection. Call
 * binaries by BARE NAME so they resolve the way they do in the operator's
 * terminal.
 */
export const testsPass = (argv: readonly string[]): TGate => {
  const [binary, ...args] = argv
  const command = argv.join(' ')
  return {
    name: `tests_pass(${command})`,
    check: () => {
      const result = spawnSync(binary ?? '', args, {
        encoding: 'utf8',
        env: { ...operatorEnv() },
      })
      const code = result.status ?? 1
      const ok = code === 0
      const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(
        -TAIL_CHARS,
      )
      return addCheck(
        emptyReport,
        command,
        ok,
        ok ? `exit ${code}` : `exit ${code}\n${tail}`,
      )
    },
  }
}
