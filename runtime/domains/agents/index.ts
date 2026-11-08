/** Coding-agent hosts and their I/O — pi, Claude Code, prompt files, steering */

export { inboxSince, postToInbox } from './src/data/inbox'
export type { TNarrationRecord } from './src/data/pi-agent'
export {
  createNarrationTracker,
  createToolCallTracker,
} from './src/data/pi-agent'
export type { TPiControl, TPiHooks } from './src/data/pi-agent-run'
export { run } from './src/data/pi-agent-run'
export {
  render,
  resolvePromptPath,
  resolveReference,
  savePrompt,
} from './src/data/prompt-files'
export { appendSteering, readSteering } from './src/data/steering'
export type { TPiRequest, TPiResult, TUsageBreakdown } from './src/typedefs/pi'
export { emptyUsage, mergeUsage } from './src/typedefs/pi'
export type { TResolveModel } from './src/use-cases/validate-agents'
export { validateAgents } from './src/use-cases/validate-agents'
