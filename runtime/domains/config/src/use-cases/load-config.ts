/**
 * Loading the roster, and resolving a name to the agent that answers to it.
 */

import { dirname, join } from 'node:path'
import type { TAgentConfig, TPiCrustConfig } from '../../../../lib/contracts'
import {
  activitiesFileSchema,
  activityPatchFileSchema,
  crustConfigSchema,
  DEFAULT_CONFIG_PATH,
  mergeActivities,
  plannerFaults,
  terminalFaults,
} from '../../../../lib/contracts'
import {
  dataDirFromEnv,
  fileExists,
  readText,
  type TEnv,
} from '../../../../lib/system'
import { applyMachineLayer, readMachineConfig } from './machine-config'
import { applyLocalOverrides, localConfigPath } from './merge-config'
import { removedSettingFaults } from './removed-settings'

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
        ...inherited,
        ...entry,
      }
    })
  const merged = {
    ...raw,
    agents: inherit(raw.agents),
    activities: inherit(raw.activities),
    planners: inherit(raw.planners),
    terminal: inherit(raw.terminal),
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
  /** '' when no machine layer was found (1.2.1, 1.2.10) */
  machinePath: string
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
  terminal: readonly unknown[]
}>

const EMPTY_REGISTRY: TRegistryFile = {
  activities: [],
  planners: [],
  terminal: [],
}

/**
 * The registry file as WRITTEN, having been checked.
 *
 * Validated through the schema and then discarded, because what the merge
 * needs is the keys the file actually set. Keeping the parsed value instead
 * silently broke inheritance: the schema fills `model` with its own fallback,
 * so every Activity arrived at `resolveConfig` already holding a model, the
 * `!(key in entry)` test never fired, and `defaults.model` in
 * `crust.config.yaml` was read by nothing. A fresh stamp then failed
 * validation against a Google model nobody had written down anywhere.
 *
 * The schema's defaults are not lost — `crustConfigSchema` applies them at
 * the end, which is after inheritance rather than before it.
 */
const checkedRegistry = (path: string): TRegistryFile => {
  const raw = asRecord(Bun.YAML.parse(readText(path)))
  activitiesFileSchema.parse(raw)

  return {
    activities: Array.isArray(raw.activities) ? raw.activities : [],
    planners: Array.isArray(raw.planners) ? raw.planners : [],
    terminal: Array.isArray(raw.terminal) ? raw.terminal : [],
  }
}

const activitiesBeside = (configPath: string): TRegistryFile => {
  const path = join(dirname(configPath), 'crust.activities.yaml')
  if (!fileExists(path)) {
    return EMPTY_REGISTRY
  }
  const base = checkedRegistry(path)
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
    /** Same rule, same reason, for the terminal Activities. */
    terminal: mergeActivities(
      base.terminal as unknown as readonly Record<string, unknown>[],
      local.terminal,
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

  return fileExists(path) ? asRecord(Bun.YAML.parse(readText(path))) : {}
}

/** The observe file's keys, minus the themes the visualizer reads itself. */
const observabilitySettings = (configPath: string): TRawRecord => {
  const {
    themes: _themes,
    default_theme: _default,
    ...settings
  } = observabilityBeside(configPath)

  return settings
}

/**
 * Assemble this repository's own document \u2014 `crust.config.yaml`, with the
 * registry and `crust.observe.yaml` merged in \u2014 BEFORE the machine layer or
 * `.local` apply. Shared by `loadConfigWithNotes` and `configProvenance`
 * (1.2.10) so the two can never disagree about what "the repository's own
 * config" means.
 */
const assembleBaseDocument = (path: string): unknown => {
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
  const terminalFaultList = terminalFaults(
    registry.terminal as readonly Readonly<{ name: string }>[],
  )
  if (registry.activities.length > 0 && terminalFaultList.length > 0) {
    throw new Error(
      `the terminal Activity configuration cannot run:\n- ${terminalFaultList.join('\n- ')}`,
    )
  }
  /*
   * The roster is the three lists together, because an Activity IS an agent.
   * `agents` keeps its name and its shape so that resolving an owner,
   * enforcing a writes boundary and rendering a prompt stay one code path.
   */
  const roster = [
    ...registry.activities,
    ...registry.planners,
    ...registry.terminal,
  ]
  const withAgents =
    roster.length === 0
      ? document
      : {
          ...(document as object),
          agents: roster,
          activities: registry.activities,
          planners: registry.planners,
          terminal: registry.terminal,
        }
  return Object.keys(observability).length === 0
    ? withAgents
    : {
        ...asRecord(withAgents),
        observability: {
          ...asRecord(asRecord(withAgents).observability),
          ...observability,
        },
      }
}

export const loadConfigWithNotes = (
  path: string = DEFAULT_CONFIG_PATH,
): TLoadedConfig => {
  const machine = readMachineConfig()
  const localPath = localConfigPath(path)
  const files = [
    path,
    join(dirname(path), 'crust.activities.yaml'),
    join(dirname(path), 'crust.activities.local.yaml'),
  ]
  const faults = removedSettingFaults([
    ...files.filter(fileExists).map((file) => ({
      file,
      document: Bun.YAML.parse(readText(file)),
    })),
    ...(machine.path === ''
      ? []
      : [
          { file: machine.path, document: machine.ordinary },
          { file: `${machine.path} (override:)`, document: machine.override },
        ]),
    ...(fileExists(localPath)
      ? [
          {
            file: localPath,
            document: Bun.YAML.parse(readText(localPath)),
          },
        ]
      : []),
  ])
  if (faults.length > 0) {
    throw new Error(
      `this configuration still carries settings pi-crust has removed:\n- ${faults.join('\n- ')}`,
    )
  }
  const base = assembleBaseDocument(path)
  /*
   * The machine layer (1.2.1–1.2.7) sits between the schema's own defaults
   * and this repository's config: its ORDINARY section is weaker than
   * anything stated here, and its `override:` section is stronger than
   * everything except this repository's OWN `.local` file and an
   * environment variable or flag — which is why it is applied here, before
   * `.local`, rather than after.
   */
  const layered = applyMachineLayer(base, machine)
  if (!fileExists(localPath)) {
    return {
      config: resolveConfig(layered.document),
      localPath: '',
      machinePath: machine.path,
      warnings: layered.warnings,
    }
  }
  const applied = applyLocalOverrides(
    layered.document,
    Bun.YAML.parse(readText(localPath)),
  )
  return {
    config: resolveConfig(applied.document),
    localPath,
    machinePath: machine.path,
    warnings: [...layered.warnings, ...applied.warnings],
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

/**
 * Every effective `defaults.*` and `observability.*` value, together with
 * the file that set it (issue #24, 1.2.10).
 *
 * Scoped to exactly the two sections the machine layer is allowed to touch
 * (1.2.7) \u2014 `agents`, `activities`, `planners` and `tasks` are not
 * reported here because the machine layer, and this provenance report that
 * exists for it, never reaches them.
 */
export type TProvenanceEntry = Readonly<{
  key: string
  value: unknown
  source: string
}>

const DEFAULTS_LEAF_KEYS = [
  'coding_agent',
  'model',
  'thinking',
  'color',
  'tools',
  'protected_files',
  'protected.read',
  'protected.write',
  'ignored.read',
  'ignored.write',
  'data_dir',
] as const

const OBSERVABILITY_LEAF_KEYS = [
  'db',
  'poll_ms',
  'ports.backend',
  'ports.frontend',
] as const

const atPath = (value: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((node, part) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as TRawRecord)[part]
  }, value)

const statesKey = (section: unknown, dotted: string): boolean =>
  atPath(section, dotted) !== undefined

export const configProvenance = (
  path: string = DEFAULT_CONFIG_PATH,
  env: TEnv = process.env,
): readonly TProvenanceEntry[] => {
  const base = assembleBaseDocument(path)
  const machine = readMachineConfig(env)
  const localPath = localConfigPath(path)
  const localDoc = fileExists(localPath)
    ? Bun.YAML.parse(readText(localPath))
    : undefined
  const config = loadConfigWithNotes(path).config

  const sourceFor = (
    section: 'defaults' | 'observability',
    dotted: string,
  ): string => {
    if (
      section === 'defaults' &&
      dotted === 'data_dir' &&
      dataDirFromEnv(env) !== undefined
    ) {
      return 'CRUST_DATA_DIR (environment)'
    }
    if (
      localDoc !== undefined &&
      statesKey(asRecord(localDoc)[section], dotted)
    ) {
      return `${localPath} (repository, private)`
    }
    if (
      machine.override !== undefined &&
      statesKey(asRecord(machine.override)[section], dotted)
    ) {
      return `${machine.path} (machine, override:)`
    }
    if (statesKey(asRecord(base)[section], dotted)) {
      return `${path} (repository, committed)`
    }
    if (
      machine.ordinary !== undefined &&
      statesKey(asRecord(machine.ordinary)[section], dotted)
    ) {
      return `${machine.path} (machine, ordinary)`
    }
    return 'runtime/lib/contracts/src/config.ts (built-in default)'
  }

  const entriesFor = (
    section: 'defaults' | 'observability',
    keys: readonly string[],
  ): readonly TProvenanceEntry[] =>
    keys.map((key) => ({
      key: `${section}.${key}`,
      value: atPath(config[section], key),
      source: sourceFor(section, key),
    }))

  return [
    ...entriesFor('defaults', DEFAULTS_LEAF_KEYS),
    ...entriesFor('observability', OBSERVABILITY_LEAF_KEYS),
  ]
}
