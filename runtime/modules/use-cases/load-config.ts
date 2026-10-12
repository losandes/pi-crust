/**
 * Loading the roster, and resolving a name to the agent that answers to it.
 */

import { dirname, join } from 'node:path'
import { fileExists, readText } from '../data/files'
import {
  activitiesFileSchema,
  activityPatchFileSchema,
  mergeActivities,
  plannerFaults,
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
  const inherit = (entries: unknown): readonly unknown[] =>
    (Array.isArray(entries) ? entries : []).map((agent) => {
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
    })
  const merged = {
    ...raw,
    agents: inherit(raw.agents),
    activities: inherit(raw.activities),
    planners: inherit(raw.planners),
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
type TRegistryFile = Readonly<{
  activities: readonly unknown[]
  planners: readonly unknown[]
}>

const EMPTY_REGISTRY: TRegistryFile = { activities: [], planners: [] }

const activitiesBeside = (configPath: string): TRegistryFile => {
  const path = join(dirname(configPath), 'crust.activities.yaml')
  if (!fileExists(path)) {
    return EMPTY_REGISTRY
  }
  const base = activitiesFileSchema.parse(Bun.YAML.parse(readText(path)))
  const localPath = path.replace(/\.yaml$/, '.local.yaml')
  if (!fileExists(localPath)) {
    return base
  }
  const local = activityPatchFileSchema.parse(
    Bun.YAML.parse(readText(localPath)),
  )

  return {
    activities: mergeActivities(
      base.activities as unknown as readonly Record<string, unknown>[],
      local.activities,
    ),
    /*
     * A local layer tunes a Planner the same way it tunes an Activity, and
     * cannot add one: `plannerFaults` is checked on the MERGED list, so a
     * local entry naming something that is not a Planner is refused here
     * rather than quietly becoming a fourth Planner nothing can reach.
     */
    planners: mergeActivities(
      base.planners as unknown as readonly Record<string, unknown>[],
      local.planners,
    ),
  }
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
  const registry = activitiesBeside(path)
  const observability = observabilitySettings(path)
  const faults = plannerFaults(
    registry.planners as readonly Readonly<{ name: string }>[],
  )
  if (registry.activities.length > 0 && faults.length > 0) {
    throw new Error(
      `the Planner configuration cannot run:\n- ${faults.join('\n- ')}`,
    )
  }
  /*
   * The roster is the two lists together, because an Activity IS an agent.
   * `agents` keeps its name and its shape so that resolving an owner,
   * enforcing a writes boundary and rendering a prompt stay one code path.
   */
  const roster = [...registry.activities, ...registry.planners]
  const withAgents =
    roster.length === 0
      ? document
      : {
          ...(document as object),
          agents: roster,
          activities: registry.activities,
          planners: registry.planners,
        }
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
