/**
 * Loading the roster, and resolving a name to the agent that answers to it.
 */

import { fileExists, readText } from '../data/files'
import type { TAgentConfig, TPiCrustConfig } from '../typedefs/config'
import { crustConfigSchema, DEFAULT_CONFIG_PATH } from '../typedefs/config'
import { applyLocalOverrides, localConfigPath } from './merge-config'

/** Keys an agent inherits from `defaults` only when it has not stated its own. */
const INHERITED = [
  'coding_agent',
  'model',
  'thinking',
  'color',
  'tools',
  'writes',
] as const

type TRawRecord = Record<string, unknown>

const asRecord = (value: unknown): TRawRecord =>
  value !== null && typeof value === 'object' ? (value as TRawRecord) : {}

/**
 * Apply the inheritance every agent gets from `defaults`, then validate.
 *
 * Takes a parsed document rather than text, because a local layer is merged
 * BEFORE inheritance runs: an agent that gets its model from `defaults` in
 * the repository config must pick up a model the local layer set on those
 * same defaults, and inheritance applied twice to two documents could not do
 * that.
 */
export const resolveConfig = (document: unknown): TPiCrustConfig => {
  const raw = asRecord(document)
  const defaults = asRecord(raw.defaults)
  const agents = Array.isArray(raw.agents) ? raw.agents : []
  const merged = {
    ...raw,
    agents: agents.map((agent) => {
      const entry = asRecord(agent)
      const inherited = Object.fromEntries(
        INHERITED.filter((key) => key in defaults && !(key in entry)).map(
          (key) => [key, defaults[key]],
        ),
      )
      return {
        harness_engineering: defaults.harness_engineering ?? [],
        ...inherited,
        ...entry,
      }
    }),
  }
  return crustConfigSchema.parse(merged)
}

export const parseConfig = (yamlText: string): TPiCrustConfig =>
  resolveConfig(Bun.YAML.parse(yamlText))

/** The roster in force, plus anything a reader should be told about it. */
export type TLoadedConfig = Readonly<{
  config: TPiCrustConfig
  /** '' when no local layer was found */
  localPath: string
  warnings: readonly string[]
}>

/**
 * The roster in force: the repository's config, with a local layer over it.
 *
 * `crust.config.local.yaml` sits beside whichever config was chosen and is
 * gitignored. Absent — the normal case — nothing changes.
 */
export const loadConfigWithNotes = (
  path: string = DEFAULT_CONFIG_PATH,
): TLoadedConfig => {
  const base = Bun.YAML.parse(readText(path))
  const localPath = localConfigPath(path)
  if (!fileExists(localPath)) {
    return { config: resolveConfig(base), localPath: '', warnings: [] }
  }
  const applied = applyLocalOverrides(base, Bun.YAML.parse(readText(localPath)))
  return {
    config: resolveConfig(applied.document),
    localPath,
    warnings: applied.warnings,
  }
}

export const loadConfig = (path: string = DEFAULT_CONFIG_PATH): TPiCrustConfig =>
  loadConfigWithNotes(path).config

export const resolveAgent = (cfg: TPiCrustConfig, name: string): TAgentConfig => {
  const agent = cfg.agents.find((candidate) => candidate.name === name)
  if (agent === undefined) {
    throw new Error(
      `agent '${name}' is not defined in the config — available: ` +
        `${cfg.agents.map((candidate) => candidate.name).join(', ') || '(none)'}`,
    )
  }
  return agent
}
