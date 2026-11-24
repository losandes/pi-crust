/** The SQLite trace, its reader, and what observes a run */

export {
  recordBranchSteer,
  recordOverwriteSteer,
} from './src/data/mutate-steer-record'
export type { TAgentSessionRef } from './src/data/resolve-agent-session-by-agent'
export { resolveAgentSessionByAgent } from './src/data/resolve-agent-session-by-agent'
export {
  resolveConsultTarget,
  type TConsultTarget,
} from './src/data/resolve-consult-target'
export {
  resolveTraceListing,
  type TTraceListing,
} from './src/data/resolve-trace-listing'
export {
  resolveWaitingRuns,
  type TWaitingRun,
} from './src/data/resolve-waiting-runs'
export { createTracer } from './src/data/trace-db'
export { runHasLiveProcess } from './src/data/trace-reader'
export type { TObserveEnv } from './src/data/visualizer'
export {
  backendPort,
  frontendPort,
  observeDbPath,
  observeEnv,
  runLink,
  visualizerIsUp,
} from './src/data/visualizer'
export type { TPrunable } from './src/use-cases/prune'
export { parseAge, pruneVerdict, workspacesIn } from './src/use-cases/prune'
export {
  latestByName,
  latestLogPayload,
  readRunState,
} from './src/use-cases/read-run-state'
