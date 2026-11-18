import {
  settleAsync,
  type TSettlement,
} from '../../../../../lib/typedefs/src/settlement'

export const openPiSession = (
  argv: readonly string[],
): Promise<TSettlement<number>> =>
  settleAsync(async () => {
    const proc = Bun.spawn([...argv], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return await proc.exited
  })
