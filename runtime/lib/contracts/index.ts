/** The shared domain model, used across three or more domains */

export type {
  TActivityConfig,
  TPlannerConfig,
  TPrompts,
  TTerminalConfig,
} from './src/activity'
export {
  activitiesFileSchema,
  activityConfigSchema,
  activityNamed,
  activityPatchFileSchema,
  activitySuccession,
  DEFAULT_ATTEMPTS,
  IMPORT_NAME,
  isImportName,
  isPlannerName,
  isTerminalName,
  mergeActivities,
  PLANNER_NAMES,
  plannerFaults,
  TERMINAL_NAMES,
  THINKING_LEVELS,
  terminalConfigSchema,
  terminalFaults,
} from './src/activity'
export type {
  TActivityRun,
  TActivityRunParams,
  TActivityRunStatus,
} from './src/activity-run'
export { activityRunParams } from './src/activity-run'
export type {
  TBaseBranch,
  TBaseBranchSource,
  TBaseRef,
  TChangeCapture,
  TChangeSet,
  TRangeSelection,
} from './src/changes'
export {
  BASE_BRANCH_SOURCES,
  BUILT_IN_BASE_BRANCH,
  baseRefLabel,
  changeCapture,
  changeSetEmpty,
  isRange,
} from './src/changes'
export type {
  TAgentConfig,
  TPathPolicy,
  TPathPolicyVerb,
  TPiCrustConfig,
  TTask,
} from './src/config'
export {
  agentConfigSchema,
  crustConfigSchema,
  DEFAULT_BE_PORT,
  DEFAULT_CONFIG_PATH,
  DEFAULT_DB,
  DEFAULT_FE_PORT,
  TASK_MOMENTS,
  TASK_NAME,
  taskConfigSchema,
  taskSchema,
  taskTriggerFaults,
  taskTriggerSchema,
} from './src/config'
export type {
  TBuildOutput,
  TChangesOutput,
  TEnvelopeBase,
  TEnvelopeSpec,
  TImportOutput,
  TImportSource,
  TPlanOutput,
  TPullRequestOutput,
  TQuestion,
  TRegression,
  TReviewOutput,
} from './src/envelope'
export {
  blockingQuestions,
  buildOutput,
  buildOutputSchema,
  contextEnvelopeSchema,
  ENVELOPE_NAMES,
  envelopeAccepted,
  envelopeJudges,
  envelopeNamed,
  genericOutput,
  IMPORT_SOURCE_KINDS,
  importedCommentSchema,
  importedDocumentSchema,
  importedVersionSchema,
  importOutput,
  importOutputSchema,
  importSourceSchema,
  narrowEnvelope,
  operatorPlanOutput,
  planOutput,
  planOutputSchema,
  pullRequestOutput,
  questionsOf,
  regressionOf,
  reviewOutput,
  reviewOutputSchema,
  UNATTRIBUTED_REASONS,
  unattributedSchema,
} from './src/envelope'
export type { TAgentCall, TGate, TGateCheck, TGateReport } from './src/gate'
export { addCheck, emptyReport, reportPassed, violationsOf } from './src/gate'
export type { TLifecycleConfig, TLifecycleFault, TStage } from './src/lifecycle'
export {
  activityOrder,
  DEFAULT_LIFECYCLES_PATH,
  importIn,
  lifecycleConfigSchema,
  lifecycleFaults,
  lifecycleNamed,
  lifecyclesFileSchema,
  misplacedImport,
  misplacedTerminal,
  stagePlan,
  terminalIn,
  withoutImport,
  withoutTerminal,
} from './src/lifecycle'
export type { TOpenedArtifact } from './src/opened-artifact'
export {
  GITHUB_ISSUE_URL,
  ISSUE_OPENED_EVENT,
  issueOpenedBy,
  openedArtifacts,
  PULL_REQUEST_EVENT,
  renderOpened,
} from './src/opened-artifact'
export type {
  TActivityRunHandle,
  TAgentMapEntry,
  TConsole,
  TRun,
} from './src/run'
export type {
  TActivityRunLog,
  TActivityRunState,
  TEnvelopeRecord,
  TGateOutcome,
  TRunState,
} from './src/run-state'
export { EXIT } from './src/run-state'
export type {
  TActivity,
  TActivityContext,
  TActivityOptions,
  TActivityOutcome,
  TActivityResult,
  TUpstream,
} from './src/runnable-activity'
export {
  acceptedExcluding,
  activityNameFromRun,
  activityRunName,
  allAccepted,
  DEFAULT_ACTIVITY_OPTIONS,
} from './src/runnable-activity'
export { hasQuotedTaskVariable, TASK_VARIABLE } from './src/task-command'
export type { TEventInput, TEventPayload, TTracer } from './src/trace'
export {
  describeTrust,
  stanceFor,
  TRUST_DEFAULT,
  TRUST_PROVISIONAL,
  trustLevel,
  trustStance,
} from './src/trust'
export type { TUnit } from './src/unit'
export { activityGates, wantsStageGate } from './src/unit'
export type { TTreeWarning } from './src/warning'
export {
  outstandingUncommitted,
  renderWarnings,
  standingWarnings,
  WARNING_EVENT,
  warningFromPayload,
  warningPayload,
} from './src/warning'
