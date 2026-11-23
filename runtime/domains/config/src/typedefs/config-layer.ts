export const LAYER_NAMES = ['package', 'machine', 'repository'] as const
export type TLayerName = (typeof LAYER_NAMES)[number]
export const ENTRY_SECTIONS = [
  'activities',
  'planners',
  'terminal',
  'lifecycles',
] as const
export type TEntrySection = (typeof ENTRY_SECTIONS)[number]
export const LAYER_FILE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'crust.config.toml': ['defaults', 'db', 'poll_ms', 'ports'],
  'crust.activities.toml': ['activities', 'planners', 'terminal'],
  'crust.lifecycles.toml': ['lifecycles'],
}
export const REPOSITORY_FILE_KEYS = [
  'tasks',
  'task_config',
  ...Object.values(LAYER_FILE_KEYS).flat(),
] as const
export type TTomlDocument = Readonly<Record<string, unknown>>
export type TLayerFile = Readonly<{
  layer: TLayerName
  path: string
  allowedKeys: readonly string[]
  document: TTomlDocument
}>
export type TConfigLayer = Readonly<{
  name: TLayerName
  promptRoot: string
  files: readonly TLayerFile[]
  document: TTomlDocument
}>
export type TLegacyFindings = Readonly<{
  repositoryDirectory: string
  repositoryFiles: readonly string[]
  machineFile: string
  machineVariableFile: string
}>
export type TReadLayers = Readonly<{
  layers: readonly TConfigLayer[]
  machineDirectory: string
  legacy: TLegacyFindings
}>
