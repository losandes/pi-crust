import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { settleAsync, type TSettlement } from '../../../../../lib/typedefs'

export const openPiSession = (
  argv: readonly string[],
): Promise<TSettlement<number>> =>
  settleAsync(async () => {
    const proc = spawn(argv[0] ?? '', argv.slice(1), { stdio: 'inherit' })
    return await new Promise<number>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('close', (code, signal) =>
        resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)),
      )
    })
  })
