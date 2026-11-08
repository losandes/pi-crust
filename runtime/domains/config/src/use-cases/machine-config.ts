/**
 * The machine configuration layer — issue #24, section 1.2.
 *
 * `~/.pi-crust/config/crust.config.yaml` holds a developer's preferences for
 * every repository on this machine, not one repository's own answer.  It
 * sits beside the `workspaces.jsonl` that `workspace-registry.ts` already
 * keeps at `~/.pi-crust/`, and its absence changes nothing (1.2.1).
 *
 * Two sections, two different strengths (1.2.2, 1.2.3):
 *
 *   top level   an ORDINARY layer — the repository's own crust.config.yaml
 *               overrules it
 *   `override:` the SAME document shape, but it beats the repository's
 *               config — visible and named, rather than a precedence rule
 *               nobody can see
 *
 * Full precedence, strongest first: a CLI flag; an environment variable; the
 * repository's `crust.config.local.yaml`; the machine file's `override:`;
 * the repository's `crust.config.yaml` (plus what is merged into it); the
 * machine file's ordinary section; the schema's built-in defaults.
 *
 * Merging happens on RAW parsed documents, before `crustConfigSchema` fills
 * in its own defaults (1.2.4) — the same reason `applyLocalOverrides`
 * already works this way, and its per-key, nested-object merge semantics are
 * reused here rather than reimplemented.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TEnv } from '../../../../lib/system'
import {
  fileExists,
  machineConfigPathFromEnv,
  readText,
} from '../../../../lib/system'
import { applyLocalOverrides, type TLocalResult } from './merge-config'

/** Where the machine layer lives, honouring `CRUST_MACHINE_CONFIG` (1.2.8). */
export const machineConfigPath = (env: TEnv = process.env): string => {
  const override = machineConfigPathFromEnv(env)
  return (
    override ??
    join(env.HOME ?? homedir(), '.pi-crust', 'config', 'crust.config.yaml')
  )
}

type TRecord = Record<string, unknown>

const isRecord = (value: unknown): value is TRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The machine file, split into its ordinary layer and its forced `override:`. */
export type TMachineConfig = Readonly<{
  /** '' when no machine file was found */
  path: string
  ordinary: unknown
  override: unknown
}>

const NO_MACHINE_CONFIG: TMachineConfig = {
  path: '',
  ordinary: undefined,
  override: undefined,
}

/**
 * Read and split the machine file. Absence changes nothing (1.2.1): a
 * missing file reads exactly as `NO_MACHINE_CONFIG`.
 *
 * The `override:` key is stripped from the ordinary document before it goes
 * anywhere near the schema (1.2.5) — `override` is not itself a config key,
 * and a repository or schema that happened to define one would otherwise
 * collide with it.
 */
export const readMachineConfig = (env: TEnv = process.env): TMachineConfig => {
  const path = machineConfigPath(env)
  if (!fileExists(path)) {
    return NO_MACHINE_CONFIG
  }
  const parsed = Bun.YAML.parse(readText(path))
  if (!isRecord(parsed)) {
    return { path, ordinary: parsed, override: undefined }
  }
  const { override, ...ordinary } = parsed
  return { path, ordinary, override }
}

/**
 * Apply the machine layer to an already-local-merged document.
 *
 * Order (1.2.3), strongest first, is applied by calling this BEFORE the
 * repository's `.local` layer: ordinary machine settings go in first (weaker
 * than the repository's own config), then the repository's config is what
 * the caller already assembled, then `.local` goes on top of all of it, then
 * finally `override:` — which beats even `.local` — is applied last.
 *
 * Reuses `applyLocalOverrides`'s per-key, nested-object merge (1.2.4) for
 * both directions, since "apply a layer, key by key, with one side winning"
 * is the same rule regardless of which side is stronger.
 *
 * 1.2.9: a name the base document does not have warns rather than fails,
 * through the same `TLocalResult.warnings` channel.
 */
export const applyMachineLayer = (
  base: unknown,
  machine: TMachineConfig,
): TLocalResult => {
  const withOrdinary = applyOrdinaryUnderBase(base, machine.ordinary)
  const withOverride = applyLocalOverrides(
    withOrdinary.document,
    machine.override,
  )
  return {
    document: withOverride.document,
    warnings: [...withOrdinary.warnings, ...withOverride.warnings],
  }
}

/**
 * The ordinary section is WEAKER than the repository's config (1.2.3): a key
 * the repository already states must survive. `applyLocalOverrides(base,
 * patch)` lets `patch` win, so the ordinary layer is applied the other way
 * round — the repository's own document patched OVER the machine's ordinary
 * settings — and the result (not the warnings, which describe the
 * repository shadowing the machine, not an error) is what callers use.
 */
const applyOrdinaryUnderBase = (
  base: unknown,
  ordinary: unknown,
): TLocalResult => {
  if (ordinary === undefined) {
    return { document: base, warnings: [] }
  }
  const merged = applyLocalOverrides(ordinary, base)
  return { document: merged.document, warnings: [] }
}
