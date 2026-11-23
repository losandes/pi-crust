/** What an agent may touch and which paths it changed */

export type { TRepoAfter } from './src/use-cases/enforce-permissions'
export {
  enforcePermissions,
  handoffDocument,
  matchesPattern,
  resolveWrites,
} from './src/use-cases/enforce-permissions'
export {
  claimedPaths,
  observationsIn,
  observedPayload,
  PATHS_TOUCHED,
  touchedBy,
  unexpectedWarnings,
} from './src/use-cases/observed-paths'
export type {
  TGoverned,
  TPathSettings,
  TRefusal,
  TToolCall,
} from './src/use-cases/path-policy'
export {
  governToolCall,
  refusalLine,
  refusalMessage,
} from './src/use-cases/path-policy'
export {
  armPolicy,
  policyPaths,
  refusalsIn,
  stopMessage,
} from './src/use-cases/path-policy-run'
export type {
  TRunChange,
  TRunChangePorts,
  TRunStart,
} from './src/use-cases/run-change'
export {
  RUN_START,
  recordRunStart,
  runChange,
  runChangeBase,
  runStartIn,
  runStartSchema,
} from './src/use-cases/run-change'
