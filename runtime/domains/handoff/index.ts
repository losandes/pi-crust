/** The session directory and the artifacts activities hand each other */

export {
  isStepDocument,
  lockArtifacts,
  unlockArtifacts,
} from './src/data/artifact-lock'
export {
  handoffDirFor,
  recordedHandoffDir,
  writeHandoffPointer,
} from './src/data/handoff-pointer'
export {
  changed,
  diffHandoff,
  readAll,
  restoreAll,
  snapshotHandoff,
} from './src/data/handoff-snapshot'
export type { TConsultMode, TConsultRequest } from './src/use-cases/consult'
export {
  consultArgv,
  consultEvent,
  runConsult,
  sessionDirFor,
} from './src/use-cases/consult'
export {
  defaultHandoffDir,
  isSharedHandoffDir,
  resolveHandoffDir,
} from './src/use-cases/handoff-location'
export type {
  TJoinPorts,
  TJoinRefusal,
  TJoinRefusalReason,
  TJoinRequest,
  TJoinTarget,
} from './src/use-cases/join-session'
export { joinArgv, resolveJoin } from './src/use-cases/join-session'
export type { TSeeding } from './src/use-cases/steer'
export {
  activitiesToReplay,
  activityRunsToCarry,
  activityRunsToSupersede,
  developerNote,
  flagValue,
  seedingOf,
  steeringAppliedEvent,
  steeringBlock,
  steeringEntry,
  steerTargetOf,
} from './src/use-cases/steer'
