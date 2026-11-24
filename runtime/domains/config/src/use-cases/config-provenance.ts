import { DEFAULT_CONFIG_PATH } from '../../../../lib/contracts'
import {
  configPathFromEnv,
  dataDirFromEnv,
  type TEnv,
} from '../../../../lib/system'
import { backendPort, frontendPort } from '../../../trace'
import { readConfigLayers } from '../data/read-config-layers'
import type { TConfigLayer } from '../typedefs/config-layer'
import { lastStatingFile, valueAt } from './layer-lookup'
import { loadConfigWithNotes } from './load-config'

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

const fileSource = (
  layers: readonly TConfigLayer[],
  keys: readonly string[],
): string => {
  const file = lastStatingFile(layers, keys)
  return file === undefined
    ? 'shipped default — built in'
    : `${file.layer === 'package' ? 'shipped default' : file.layer} — ${file.path}`
}

export const configProvenance = (
  path: string | undefined = undefined,
  env: TEnv = process.env,
): readonly TProvenanceEntry[] => {
  const repositoryPath = path ?? configPathFromEnv(env) ?? DEFAULT_CONFIG_PATH
  const config = loadConfigWithNotes(repositoryPath, env).config
  const read = readConfigLayers(repositoryPath, env)
  if (read.status === 'error') throw read.error
  const { layers } = read.data
  const entry = (
    key: string,
    value: unknown,
    keys: readonly string[] = key.split('.'),
  ): TProvenanceEntry => ({ key, value, source: fileSource(layers, keys) })
  const withEnvironment = (
    one: TProvenanceEntry,
    variable: string,
    value: unknown,
  ): TProvenanceEntry =>
    value === undefined
      ? one
      : { ...one, value, source: `environment — ${variable}` }
  return [
    ...DEFAULTS_LEAF_KEYS.map((key) => {
      const one = entry(
        `defaults.${key}`,
        valueAt(config.defaults, key.split('.')),
      )
      return key === 'data_dir'
        ? withEnvironment(one, 'CRUST_DATA_DIR', dataDirFromEnv(env))
        : one
    }),
    entry('poll_ms', config.observability.poll_ms),
    ...(['backend', 'frontend'] as const).map((key) => {
      const variable = key === 'backend' ? 'CRUST_BE_PORT' : 'CRUST_FE_PORT'
      const port = (key === 'backend' ? backendPort : frontendPort)(
        env,
        config.observability.ports[key],
      )
      const valid =
        Number.isInteger(Number(env[variable])) &&
        Number(env[variable]) > 0 &&
        Number(env[variable]) < 65536
      return withEnvironment(
        entry(`ports.${key}`, config.observability.ports[key]),
        variable,
        valid ? port : undefined,
      )
    }),
    ...(['activities', 'planners', 'terminal'] as const).flatMap((section) =>
      config[section].flatMap((agent) => [
        ...(['model', 'thinking', 'prompts'] as const).map((key) => {
          const direct = lastStatingFile(layers, [section, agent.name, key])
          const inherited = key !== 'prompts' && direct === undefined
          return {
            key: `${section}.${agent.name}.${key}`,
            value: agent[key],
            source: inherited
              ? `${fileSource(layers, ['defaults', key])} (via defaults.${key})`
              : fileSource(layers, [section, agent.name, key]),
          }
        }),
        ...(section === 'terminal'
          ? ['remote', 'base', 'draft'].map((key) =>
              entry(
                `terminal.${agent.name}.delivery.${key}`,
                valueAt(agent, ['delivery', key]),
              ),
            )
          : []),
      ]),
    ),
    ...config.lifecycles.map((lifecycle) =>
      entry(
        `lifecycles.${lifecycle.name}.stages`,
        lifecycle.stages.map((stage) => stage.name),
      ),
    ),
  ]
}
