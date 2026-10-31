#!/usr/bin/env bun
/**
 * pi-crust Show-Config — every effective config value, with the file that set it.
 *
 * Usage:
 *     just crust config [--config <path>]
 *
 * Issue #24, 1.2.10: `loadConfigWithNotes` already reports which layers were
 * found (`localPath`, `machinePath`) and each warning a layer raised; this is
 * the recipe that prints the other half — each VALUE, not only which files
 * contributed one. The `.local` layer's protection is that it sits beside
 * the config it overrides, where a developer reviewing a diff sees it; a
 * file in the home directory has no such property, so provenance has to be
 * askable on demand, which is what this is for.
 */

import { configPathFromEnv } from './modules/data/env-overrides'
import { paint, writeLine } from './modules/data/terminal'
import { DEFAULT_CONFIG_PATH } from './modules/typedefs/config'
import { errorMessage, safeParseSettlement } from './modules/typedefs/settlement'
import { configProvenance } from './modules/use-cases/load-config'

const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

const formatted = (value: unknown): string =>
  Array.isArray(value) ? `[${value.join(', ')}]` : String(value)

export const main = (argv: readonly string[]): number => {
  const configPath =
    flagValue(argv, '--config') ?? configPathFromEnv() ?? DEFAULT_CONFIG_PATH
  const settled = safeParseSettlement(() => configProvenance(configPath))
  if (settled.status === 'error') {
    writeLine(paint(errorMessage(settled.error), 'red'))
    return 1
  }
  const width = Math.max(...settled.data.map((entry) => entry.key.length))
  for (const entry of settled.data) {
    writeLine(
      `${entry.key.padEnd(width)}  ${paint(formatted(entry.value), 'bold')}  ${paint(`\u2014 ${entry.source}`, 'dim')}`,
    )
  }
  return 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
