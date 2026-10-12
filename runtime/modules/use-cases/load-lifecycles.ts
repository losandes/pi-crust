/**
 * Read the Lifecycles a repository offers, and refuse the ones that cannot
 * run.
 *
 * `crust.lifecycles.yaml` is the team's; `crust.lifecycles.local.yaml` beside
 * it is one developer's and is gitignored. A local layer may override a
 * Lifecycle by name or add one the team file does not have — the same rule
 * Activities follow, for the same reason: whoever writes the local file can
 * write the committed one.
 *
 * Validation happens at load rather than at execution. Discovering that a
 * Lifecycle cannot run three Activities into the run wastes the three.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TPiCrustConfig } from '../typedefs/config'
import {
  DEFAULT_LIFECYCLES_PATH,
  lifecycleFaults,
  lifecyclesFileSchema,
  type TLifecycleConfig,
} from '../typedefs/lifecycle'
import { concurrencyFaults } from './concurrency-faults'

/** The local layer sits beside whichever file was chosen. */
export const localLifecyclesPath = (path: string): string =>
  join(
    dirname(path),
    (path.split('/').at(-1) ?? '').replace(/\.yaml$/, '.local.yaml'),
  )

const parseFile = (path: string): readonly TLifecycleConfig[] =>
  lifecyclesFileSchema.parse(Bun.YAML.parse(readFileSync(path, 'utf8')))
    .lifecycles

/**
 * A local Lifecycle replaces the team's outright rather than merging into it.
 *
 * Activities merge per key because they are a bag of settings. A Lifecycle is
 * a graph, and half-merging a graph — the team's stages with one of yours
 * spliced in by name — produces an arrangement neither party wrote. Naming a
 * Lifecycle locally means replacing it.
 */
export const mergeLifecycles = (
  base: readonly TLifecycleConfig[],
  local: readonly TLifecycleConfig[],
): readonly TLifecycleConfig[] => {
  const overrides = new Map(local.map((one) => [one.name, one] as const))
  const known = new Set(base.map((one) => one.name))

  return [
    ...base.map((one) => overrides.get(one.name) ?? one),
    ...local.filter((one) => !known.has(one.name)),
  ]
}

/** The lifecycles file beside whichever config was chosen. */
export const lifecyclesBeside = (configPath: string): string =>
  join(dirname(configPath), 'crust.lifecycles.yaml')

export const loadLifecycles = (
  path: string = DEFAULT_LIFECYCLES_PATH,
  /*
   * The registry, when the caller has it. A Stage claiming concurrency is
   * only checkable against what its Activities may write, and a caller
   * reading lifecycles to list them has no registry and needs no check.
   */
  cfg?: TPiCrustConfig,
): readonly TLifecycleConfig[] => {
  const base = existsSync(path) ? parseFile(path) : []
  const localPath = localLifecyclesPath(path)
  const merged = existsSync(localPath)
    ? mergeLifecycles(base, parseFile(localPath))
    : base

  const faults = merged.flatMap((lifecycle) => [
    ...lifecycleFaults(lifecycle),
    ...concurrencyFaults(lifecycle, cfg?.activities ?? []),
  ])
  if (faults.length > 0) {
    throw new Error(
      `lifecycle configuration cannot run:\n${faults
        .map((fault) => `  ${fault.lifecycle}: ${fault.message}`)
        .join('\n')}`,
    )
  }

  return merged
}
