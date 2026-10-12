#!/usr/bin/env bun
/**
 * pi-crust Checks — run this repository's own commands, with no Lifecycle.
 *
 * Usage:
 *     bun .pi-crust/checks.ts [--scope <ref|range|path|glob>] [--config <path>]
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

import { changedFiles, untrackedFiles } from './modules/data/git'
import { configPathFromEnv } from './modules/data/env-overrides'
import { paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { EXIT } from './modules/typedefs/run-state'
import { errorMessage, safeParseSettlement } from './modules/typedefs/settlement'
import { loadConfig } from './modules/use-cases/load-config'
import { matchingChecks } from './modules/use-cases/route-by-path'
import { runCommand } from './modules/use-cases/run-checks'
import { requireSelected, selectRange } from './modules/use-cases/select-range'
import { join } from 'node:path'
import { ensureDir } from './modules/data/files'
import { repoRoot } from './modules/data/git'

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
    const paths = checkedPaths(scope)
    if (paths.length === 0) {
      writeLine(paint('nothing changed — no checks apply', 'dim'))

      return EXIT.SUCCESS
    }
    const specs = matchingChecks(cfg, paths)
    if (specs.length === 0) {
      /*
       * Zero checks passing is not the same claim as zero checks failing,
       * and only one of them is evidence. Same rule the gate applies.
       */
      writeLine(
        paint(
          `${paths.length} path(s) changed but no routing.checks matched ` +
            'them — nothing was verified',
          'red',
        ),
      )

      return EXIT.FAILED
    }
    /*
     * The logs land under the data directory the config already owns, and
     * not in a session: there is no session here, and writing one would be
     * a trace row claiming an Activity Run that never happened.
     */
    const root = repoRoot()
    const logs = ensureDir(join(root, cfg.defaults.data_dir, 'checks'))
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

    return failed.length === 0 ? EXIT.SUCCESS : EXIT.FAILED
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
