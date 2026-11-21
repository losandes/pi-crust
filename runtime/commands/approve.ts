import { DECIDE_USAGE, parseDecideArgs, reportUsageError } from '../domains/cli'
import { decideRun } from '../domains/runs'
export const main = (argv: readonly string[]): Promise<number> =>
  Promise.resolve(['approve', ...argv])
    .then(parseDecideArgs)
    .then(decideRun)
    .catch(reportUsageError(DECIDE_USAGE))
if (import.meta.main) process.exit(await main(process.argv.slice(2)))
