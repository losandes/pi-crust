/** Turning activities and lifecycles into an ordered plan of Work Units */

export { loadLifecycles } from './src/use-cases/load-lifecycles'
export { chainNote, plannedChain } from './src/use-cases/operator-plan'
export { parseActivities } from './src/use-cases/parse-activities'
export {
  asSingleStage,
  plannedNames,
  unitsFrom,
} from './src/use-cases/plan-units'

export { plannedActivities } from './src/use-cases/planned-activities'
