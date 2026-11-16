/** What an agent may touch and which checks and skills a change routes to */

export {
  enforcePermissions,
  handoffDocument,
  matchesPattern,
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
export {
  matchingChecks,
  matchingSkills,
  unmatchedPaths,
} from './src/use-cases/route-by-path'
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
export {
  NOTHING_DECLARED,
  NOTHING_MATCHED,
  runCommand,
  runVerification,
} from './src/use-cases/run-checks'
