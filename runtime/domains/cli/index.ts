/** The developer-facing command surface — argv, recipes, help, menus */

export { askMenuChoice, askOne, askOrder, askText } from './src/data/ask'
export { adviceCommand } from './src/use-cases/advice'
export type { TCatalogue, TEntry } from './src/use-cases/catalogue'
export { catalogueOf, renderCatalogue } from './src/use-cases/catalogue'
export {
  DECIDE_CLI,
  positionalArgs,
  RESUME_CLI,
  STEER_CLI,
} from './src/use-cases/cli-positionals'
export {
  resumeArgvFor,
  runArgv,
  TRUST_CHOICES,
} from './src/use-cases/compose-request'
export {
  chosenLifecycle,
  chosenPlanner,
  exclusiveCount,
  expandChoices,
  menuOptions,
  PLANNERS,
} from './src/use-cases/menu-options'
export type { TModelOverride } from './src/use-cases/model-overrides'
export { parseModelOverrides } from './src/use-cases/model-overrides'
export type { TCliArgs, TWorkflowArgs } from './src/use-cases/parse-cli'
export { runCli, workflowArgs } from './src/use-cases/parse-cli'
export { RECIPE_DOCS, recipeDoc } from './src/use-cases/recipe-docs'
export { RUN_RECIPE, recipeArgv, shellLine } from './src/use-cases/recipe-line'
export { renderHelp } from './src/use-cases/render-help'
export { resolvePrompt } from './src/use-cases/resolve-prompt'
export {
  INVOCATION_FILENAME,
  recordedInvocation,
  resumeArgv,
  resumeRecordedRun,
} from './src/use-cases/resume-run'
export { displayLabel } from './src/use-cases/run-label'
