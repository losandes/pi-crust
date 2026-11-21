/** The engine that executes a run and reports it */

export { seedBranch } from './src/data/branch-seed'
export {
  consultActivity,
  type TConsultPorts,
} from './src/use-cases/consult-activity'
export { createRun } from './src/use-cases/create-run'

export { answerText, decideRun } from './src/use-cases/decide-run'
export {
  ANSWER_FILENAME,
  ANSWER_RECORD_FILENAME,
} from './src/use-cases/human-gate'
export {
  gateLines,
  MARKS,
  renderReport,
  resumeCommand,
} from './src/use-cases/render-report'
export { runWorkflow } from './src/use-cases/run-workflow'
export {
  steerBranch,
  steerOverwrite,
  type TSteerPorts,
} from './src/use-cases/steer-run'
