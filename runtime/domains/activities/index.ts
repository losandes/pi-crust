/** What an Activity is, which ones exist, and what running one means */

export {
  canonicalActivityNames,
  registryFaults,
} from './src/use-cases/activity-registry'
export { agentActivity } from './src/use-cases/agent-activity'
export type { TAgentPorts } from './src/use-cases/execute-agent'
export type { TTerminalActivity } from './src/use-cases/gh-pull-request'
export { readEnvelope } from './src/use-cases/read-envelope'
export {
  requiredAgents,
  runnableActivities,
  terminalActivityFor,
} from './src/use-cases/resolve-activities'
