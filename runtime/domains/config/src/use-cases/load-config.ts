/** Compose the three TOML layers, then inherit defaults and validate once. */
import type { TAgentConfig, TPiCrustConfig } from '../../../../lib/contracts'
import {
  crustConfigSchema,
  DEFAULT_CONFIG_PATH,
  plannerFaults,
  taskTriggerFaults,
  terminalFaults,
} from '../../../../lib/contracts'
import { configPathFromEnv, type TEnv } from '../../../../lib/system'
import { readConfigLayers } from '../data/read-config-layers'
import { assembleConfig } from './assemble-config'
import { layerFaults } from './layer-faults'
import { legacyConfigNotices } from './legacy-config-notices'
import { tableOf } from './merge-layers'
import { removedSettingFaults } from './removed-settings'
import { themeNotices } from './theme-notices'

const INHERITED = [
  'coding_agent',
  'model',
  'thinking',
  'color',
  'tools',
  'writes',
] as const

export const resolveConfig = (document: unknown): TPiCrustConfig => {
  const raw = tableOf(document)
  const defaults = tableOf(raw.defaults)
  const inherit = (entries: unknown): readonly unknown[] =>
    (Array.isArray(entries) ? entries : []).map((agent: unknown) => {
      const entry = tableOf(agent)
      return {
        ...Object.fromEntries(
          INHERITED.filter((key) => key in defaults && !(key in entry)).map(
            (key) => [key, defaults[key]],
          ),
        ),
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
  const parsed = crustConfigSchema.safeParse(merged)
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => {
          const [section, index, ...rest] = issue.path
          const entries = merged[section as keyof typeof merged]
          const name =
            typeof index === 'number' && Array.isArray(entries)
              ? tableOf(entries[index]).name
              : index
          const namedSection =
            section === 'agents'
              ? ((['activities', 'planners', 'terminal'] as const).find(
                  (candidate) =>
                    merged[candidate].some(
                      (entry) => tableOf(entry).name === name,
                    ),
                ) ?? section)
              : section
          return `${[namedSection, name, ...rest].filter((part) => part !== undefined).join('.')}: ${issue.message}`
        })
        .join('\n'),
    )
  }
  const config = parsed.data
  const faults = [
    ...plannerFaults(config.planners),
    ...terminalFaults(config.terminal),
    ...taskTriggerFaults(config),
  ]
  if (faults.length > 0)
    throw new Error(`the configuration cannot run:\n- ${faults.join('\n- ')}`)
  return config
}

export type TLoadedConfig = Readonly<{
  config: TPiCrustConfig
  machinePath: string
  warnings: readonly string[]
}>

export const loadConfigWithNotes = (
  path: string | undefined = undefined,
  env: TEnv = process.env,
): TLoadedConfig => {
  const repositoryPath = path ?? configPathFromEnv(env) ?? DEFAULT_CONFIG_PATH
  const read = readConfigLayers(repositoryPath, env)
  if (read.status === 'error') throw read.error
  const { layers, machineDirectory, legacy } = read.data
  const removed = removedSettingFaults(
    layers.flatMap((layer) =>
      layer.files.map((file) => ({ file: file.path, document: file.document })),
    ),
  )
  if (removed.length > 0)
    throw new Error(
      `this configuration still carries settings pi-crust has removed:\n- ${removed.join('\n- ')}`,
    )
  const faults = layerFaults(layers)
  if (faults.length > 0) throw new Error(faults.join('\n'))
  const assembled = assembleConfig(layers)
  if (assembled.faults.length > 0)
    throw new Error(
      `lifecycle configuration cannot load:\n${assembled.faults.map((fault) => `  ${fault.lifecycle}: ${fault.message}`).join('\n')}`,
    )
  return {
    config: resolveConfig(assembled.document),
    machinePath: layers.find((layer) => layer.name === 'machine')?.files.length
      ? machineDirectory
      : '',
    warnings: [
      ...legacyConfigNotices(legacy, { repositoryPath, machineDirectory }),
      ...themeNotices(layers, machineDirectory),
    ],
  }
}

export const loadConfig = (
  path: string | undefined = undefined,
  env: TEnv = process.env,
  notify: (notice: string) => void = (notice) =>
    process.stderr.write(`pi-crust: ${notice}\n`),
): TPiCrustConfig => {
  const loaded = loadConfigWithNotes(path, env)
  loaded.warnings.forEach(notify)
  return loaded.config
}

export const resolveAgent = (
  cfg: TPiCrustConfig,
  name: string,
): TAgentConfig => {
  const agent = cfg.agents.find((candidate) => candidate.name === name)
  if (agent === undefined)
    throw new Error(
      `agent '${name}' is not defined in the config — available: ${cfg.agents.map((candidate) => candidate.name).join(', ') || '(none)'}`,
    )
  return agent
}
