/** Reading and merging package, machine and repository TOML configuration. */

export type { TProvenanceEntry } from './src/use-cases/config-provenance'
export { configProvenance } from './src/use-cases/config-provenance'
export type { TLoadedConfig } from './src/use-cases/load-config'
export {
  loadConfig,
  loadConfigWithNotes,
  resolveAgent,
} from './src/use-cases/load-config'
