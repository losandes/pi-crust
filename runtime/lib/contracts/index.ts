/** The shared domain model, used across three or more domains */

export type {
  TActivityConfig,
  TPlannerConfig,
  TTerminalConfig,
} from './src/activity'
export {
  activitiesFileSchema,
  activityConfigSchema,
  activityNamed,
  activityPatchFileSchema,
  activitySuccession,
  DEFAULT_ATTEMPTS,
  isPlannerName,
  isTerminalName,
  mergeActivities,
  PLANNER_NAMES,
  plannerFaults,
  TERMINAL_NAMES,
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
  TBaseRef,
  TChangeCapture,
  TChangeSet,
  TRangeSelection,
} from './src/changes'
export {
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
  TRoutingCheck,
  TRoutingSkill,
} from './src/config'
export {
  agentConfigSchema,
  crustConfigSchema,
  DEFAULT_BE_PORT,
  DEFAULT_CONFIG_PATH,
  DEFAULT_DB,
  DEFAULT_FE_PORT,
} from './src/config'
export type {
  TBuildOutput,
  TChangesOutput,
  TEnvelopeBase,
  TEnvelopeSpec,
  TPullRequestOutput,
  TQuestion,
  TRegression,
  TReviewOutput,
} from './src/envelope'
export {
  buildOutput,
  buildOutputSchema,
  contextEnvelopeSchema,
  ENVELOPE_NAMES,
  envelopeAccepted,
  envelopeJudges,
  envelopeNamed,
  genericOutput,
  narrowEnvelope,
  operatorPlanOutput,
  pullRequestOutput,
  regressionOf,
  reviewOutput,
  reviewOutputSchema,
} from './src/envelope'
export type { TAgentCall, TGate, TGateCheck, TGateReport } from './src/gate'
export { addCheck, emptyReport, reportPassed, violationsOf } from './src/gate'
export type { TLifecycleConfig, TLifecycleFault, TStage } from './src/lifecycle'
export {
  activityOrder,
  DEFAULT_LIFECYCLES_PATH,
  lifecycleConfigSchema,
  lifecycleFaults,
  lifecycleNamed,
  lifecyclesFileSchema,
  misplacedTerminal,
  stagePlan,
  terminalIn,
  withoutTerminal,
} from './src/lifecycle'
export type {
  TQualityCheckResult,
  TQualityCheckSpec,
  TQualityResult,
} from './src/quality'
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
  renderWarnings,
  WARNING_EVENT,
  warningFromPayload,
  warningPayload,
} from './src/warning'
