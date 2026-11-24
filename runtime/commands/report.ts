import {
  parseReportArgs,
  recordedInvocation,
  reportUsageError,
  resolveDbPath,
  resolveSessionDir,
  REPORT_USAGE as USAGE,
} from '../domains/cli'
import { renderReport } from '../domains/runs'
/**
 * pi-crust Report — where did a run get to, and what do I run to finish it?
 *
 * Usage:
 *     crust report [<run-id>] [--json] [--db <path>] [--config <path>]
 *
 * `CRUST_DB` and `CRUST_CONFIG` stand in for the two path flags when they are
 * not passed, so the runtime honours the same variables the visualizer does.
 *
 * No run-id means the most recent session. `--json` emits TRunState verbatim,
 * which is the contract an agent parses — see references/observability.md.
 *
 * Exit codes, because something will branch on them:
 *     0  the run succeeded
 *     1  it failed
 *     2  no such session, or a usage error
 *     3  it is waiting for a person
 *     4  it is still running
 *
 * `3` and `4` exist because the old set conflated them with failure. A report
 * on a healthy in-flight run exited 1, so `crust report` printed `recipe
 * failed` over a run that was going fine, which is how people learn to ignore
 * a red line.
 *
 * This reads the SAME function `--resume` reads (`readRunState`), so the two
 * can never disagree about which activityRuns are already done.
 */

import { readRunState } from '../domains/trace'
import { EXIT } from '../lib/contracts'
import { writeLine } from '../lib/terminal'

export const main = (argv: readonly string[]): number => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: main is the process boundary that maps usage failures to an exit code
  try {
    const args = parseReportArgs(argv)
    const dbPath = resolveDbPath(args)
    const state = readRunState(dbPath, args.runId)
    if (state === undefined) {
      process.stderr.write(
        `no session found in ${dbPath}` +
          `${args.runId ? ` for run_id '${args.runId}'` : ''}\n${USAGE}\n`,
      )
      return EXIT.USAGE
    }
    writeLine(
      args.json
        ? JSON.stringify(state, null, 2)
        : renderReport(
            state,
            recordedInvocation(resolveSessionDir(args, dbPath, state.run_id))
              ?.argv,
          ),
    )
    if (state.status === 'waiting') {
      return EXIT.WAITING
    }
    if (state.status === 'running') {
      return EXIT.RUNNING
    }
    return state.status === 'success' && state.resume_from === undefined
      ? EXIT.SUCCESS
      : EXIT.FAILED
  } catch (error) {
    return reportUsageError(USAGE)(error)
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
