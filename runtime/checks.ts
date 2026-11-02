#!/usr/bin/env bun

/**
 * pi-crust Checks — run this repository's own commands, with no Lifecycle.
 *
 * Usage:
 *     just crust verify [--scope <ref|range|path|glob>] [--config <path>]
 *
 * The same commands the `checks` gate runs inside a run, run on their own.
 * `verify` used to be an Activity for this, which produced a verdict nothing
 * consumed; what a person wants from it is not an Activity Run in a trace,
 * it is the exit status of their own test suite against what they changed.
 *
 * No session, no agent, no trace: there is nothing here an observer would
 * want to watch, and minting a run to shell out to `bun test` would put a
 * row in the trace claiming work that nobody asked an agent for.
 */

import { basename, join } from 'node:path'
import { resolveDataPaths } from './modules/data/data-paths'
import { configPathFromEnv } from './modules/data/env-overrides'
import { ensureDir } from './modules/data/files'
import { changedFiles, repoRoot, untrackedFiles } from './modules/data/git'
import { paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { EXIT } from './modules/typedefs/run-state'
import {
  errorMessage,
  safeParseSettlement,
} from './modules/typedefs/settlement'
import { loadConfig } from './modules/use-cases/load-config'
import {
  matchingChecks,
  unmatchedPaths,
} from './modules/use-cases/route-by-path'
import {
  NOTHING_DECLARED,
  NOTHING_MATCHED,
  runCommand,
} from './modules/use-cases/run-checks'
import { requireSelected, selectRange } from './modules/use-cases/select-range'

const flagValue = (
  argv: readonly string[],
  flag: string,
): string | undefined => {
  const at = argv.indexOf(flag)

  return at === -1 ? undefined : argv[at + 1]
}

export const checkedPaths = (scope: string): readonly string[] => {
  const selection = selectRange(scope)

  return scope === ''
    ? [...changedFiles(), ...untrackedFiles()].filter(Boolean).toSorted()
    : requireSelected(selection)
}

export const main = (argv: readonly string[]): number => {
  const configPath =
    flagValue(argv, '--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH
  const scope = flagValue(argv, '--scope') ?? flagValue(argv, '--base') ?? ''
  const settled = safeParseSettlement(() => {
    const cfg = loadConfig(configPath)
    if (cfg.routing.checks.length === 0) {
      writeLine(paint(NOTHING_DECLARED, 'yellow'))

      return EXIT.SUCCESS
    }
    const paths = checkedPaths(scope)
    if (paths.length === 0) {
      writeLine(paint('nothing changed — no checks apply', 'dim'))

      return EXIT.SUCCESS
    }
    const specs = matchingChecks(cfg, paths)
    const gaps = unmatchedPaths(cfg, paths)
    if (specs.length === 0) {
      /*
       * Rules exist and none of them covers this change. Zero checks passing
       * is not the same claim as zero checks failing, but under the default
       * policy neither is a failure — the same finding the `checks` gate
       * reports for the same change (1.1.1, 1.2.3). `routing.unmatched:
       * "block"` opts a repository back into the old, failing behaviour.
       */
      const blocked = cfg.routing.unmatched === 'block'
      writeLine(
        paint(
          `${NOTHING_MATCHED(gaps.length)} (${gaps.join(', ')})`,
          blocked ? 'red' : 'yellow',
        ),
      )

      return blocked ? EXIT.FAILED : EXIT.SUCCESS
    }
    /*
     * The logs land under the data directory the config already owns, and
     * not in a session: there is no session here, and writing one would be
     * a trace row claiming an Activity Run that never happened.
     *
     * <tree> is this repository root's basename (1.5.1): a pooled store
     * holds several working trees, and `checks/<name>.log` is unique to
     * nothing once two of them share it — nor is it unique within ONE tree,
     * since two concurrent `just crust verify` invocations here still
     * overwrite each other's log (1.5.4). That collision is not fixed here;
     * `run-checks.ts` writes gate checks to a per-run, per-Activity-Run path
     * instead (1.5.2), which is why only the standalone runner needs this.
     */
    const root = repoRoot()
    const { dataDir } = resolveDataPaths(cfg, root)
    const logs = ensureDir(join(dataDir, 'checks', basename(root)))
    const results = specs.map((spec) =>
      runCommand(spec, {
        repoRoot: root,
        outputArtifact: join(logs, `${spec.name}.log`),
        note: (line) => writeLine(paint(line, 'dim')),
      }),
    )
    const failed = results.filter((result) => !result.passed)
    writeLine(
      failed.length === 0
        ? paint(`all ${results.length} check(s) passed`, 'green')
        : paint(`${failed.length} of ${results.length} check(s) failed`, 'red'),
    )
    const blockedGaps = cfg.routing.unmatched === 'block' && gaps.length > 0
    if (gaps.length > 0) {
      writeLine(
        paint(
          `${NOTHING_MATCHED(gaps.length)} (${gaps.join(', ')})`,
          blockedGaps ? 'red' : 'yellow',
        ),
      )
    }

    return failed.length === 0 && !blockedGaps ? EXIT.SUCCESS : EXIT.FAILED
  })
  if (settled.status === 'error') {
    process.stderr.write(`${errorMessage(settled.error)}\n`)

    return EXIT.FAILED
  }

  return settled.data
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
