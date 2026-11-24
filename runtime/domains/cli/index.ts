/** The developer-facing command surface — argv, recipes, help, menus */

export { askMenuChoice, askOne, askOrder, askText } from './src/data/ask'
export {
  resolveCrustHome,
  type TCrustHome,
} from './src/data/resolve-crust-home'
export { resolveEnvFiles } from './src/data/resolve-env-files'
export { runBunScript, type TScriptRun } from './src/data/run-bun-script'
export { adviceCommand } from './src/use-cases/advice'
export type { TCatalogue, TEntry } from './src/use-cases/catalogue'
export { catalogueOf, renderCatalogue } from './src/use-cases/catalogue'
export {
  DECIDE_CLI,
  JOIN_CLI,
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
  DECIDE_USAGE,
  isVerb,
  parseDecideArgs,
  type TDecideArgs,
  type TVerb,
  VERBS,
} from './src/use-cases/decide-args'
export { findFollowUpCommand } from './src/use-cases/find-follow-up-command'
export { topicOf } from './src/use-cases/help-topic'
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
export {
  planDispatch,
  type TDispatchInput,
} from './src/use-cases/plan-dispatch'
export {
  askWhichRun,
  NEW_RUN,
  planNewRun,
  planResume,
  type TAskPorts,
} from './src/use-cases/please-wizard'
export {
  RECIPE_DOCS,
  recipeDoc,
  type TCommandRun,
  type TRecipeDoc,
} from './src/use-cases/recipe-docs'
export { RUN_RECIPE, recipeArgv, shellLine } from './src/use-cases/recipe-line'
export { renderCommandList } from './src/use-cases/render-command-list'
export { renderHelp } from './src/use-cases/render-help'
export {
  parseReportArgs,
  REPORT_USAGE,
  resolveDbPath,
  resolveSessionDir,
  type TReportArgs,
  type TScan,
  VALUE_FLAGS,
} from './src/use-cases/report-args'
export { resolvePrompt } from './src/use-cases/resolve-prompt'
export {
  INVOCATION_FILENAME,
  recordedInvocation,
  resumeArgv,
  resumeRecordedRun,
  sessionDirOf,
} from './src/use-cases/resume-run'
export { displayLabel } from './src/use-cases/run-label'
export {
  JOIN_USAGE,
  LIST_USAGE,
  PRUNE_USAGE,
  reportUsageError,
} from './src/use-cases/usage'
