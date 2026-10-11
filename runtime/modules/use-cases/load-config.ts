/**
 * Loading the roster, and resolving a name to the agent that answers to it.
 */

import { dirname, join } from 'node:path'
import { fileExists, readText } from '../data/files'
import {
  activitiesFileSchema,
  activityPatchFileSchema,
  mergeActivities,
} from '../typedefs/activity'
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
/**
 * Activities live in their own file, beside the config that points at it.
 *
 * They were a block in `crust.config.yaml` when there were four of them.
 * They are a registry now — the thing a team adds to, removes from and
 * reorders — and a registry sharing a file with observability settings is a
 * file nobody can review.
 */
const activitiesBeside = (configPath: string): readonly unknown[] => {
  const path = join(dirname(configPath), 'crust.activities.yaml')
  if (!fileExists(path)) {
    return []
  }
  const base = activitiesFileSchema.parse(
    Bun.YAML.parse(readText(path)),
  ).activities
  const localPath = path.replace(/\.yaml$/, '.local.yaml')

  return fileExists(localPath)
    ? mergeActivities(
        base as unknown as readonly Record<string, unknown>[],
        activityPatchFileSchema.parse(Bun.YAML.parse(readText(localPath)))
          .activities,
      )
    : base
}

/**
 * Observability lives in its own file too, beside the config.
 *
 * It was an `observability:` block in `crust.config.yaml`, which is otherwise
 * the agent roster. Watching a run is one concern — the trace database, the
 * UI's ports, the themes it offers — and it now has one file, `crust.observe.yaml`.
 *
 * Merged into the document under the key it always had, so every caller
 * still reads `cfg.observability.db`, and so a `crust.config.local.yaml`
 * that overrides `observability.poll_ms` keeps reaching it: the local layer
 * is applied AFTER this, to the assembled document.
 *
 * A tree with no such file is an older stamp, and the schema's own defaults
 * are what it had anyway.
 */
const observabilityBeside = (configPath: string): TRawRecord => {
  const path = join(dirname(configPath), 'crust.observe.yaml')

  return fileExists(path)
    ? asRecord(Bun.YAML.parse(readText(path)))
    : {}
}

/** The observe file's keys, minus the themes the visualizer reads itself. */
const observabilitySettings = (configPath: string): TRawRecord => {
  const { themes: _themes, default_theme: _default, ...settings } =
    observabilityBeside(configPath)

  return settings
}

export const loadConfigWithNotes = (
  path: string = DEFAULT_CONFIG_PATH,
): TLoadedConfig => {
  const document = Bun.YAML.parse(readText(path))
  const activities = activitiesBeside(path)
  const observability = observabilitySettings(path)
  const withAgents =
    activities.length === 0
      ? document
      : { ...(document as object), agents: activities }
  const base =
    Object.keys(observability).length === 0
      ? withAgents
      : {
          ...asRecord(withAgents),
          observability: {
            ...asRecord(asRecord(withAgents).observability),
            ...observability,
          },
        }
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

export const loadConfig = (
  path: string = DEFAULT_CONFIG_PATH,
): TPiCrustConfig => loadConfigWithNotes(path).config

export const resolveAgent = (
  cfg: TPiCrustConfig,
  name: string,
): TAgentConfig => {
  const agent = cfg.agents.find((candidate) => candidate.name === name)
  if (agent === undefined) {
    throw new Error(
      `agent '${name}' is not defined in the config — available: ` +
        `${cfg.agents.map((candidate) => candidate.name).join(', ') || '(none)'}`,
    )
  }
  return agent
}
