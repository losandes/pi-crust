/** Acceptance — gates, disputes, regressions */

export { checks } from './src/use-cases/checks-gate'
export { diffMatchesClaims } from './src/use-cases/claim-gates'
export type { TDelivered, TDeliveryGate } from './src/use-cases/delivery-gates'
export { DELIVERY_GATES } from './src/use-cases/delivery-gates'
export { disputesSupported } from './src/use-cases/dispute-gates'
export type { TRoundRecord } from './src/use-cases/dispute-ledger'
export {
  disputeFilename,
  readLedger,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from './src/use-cases/dispute-ledger'
export { REPORT_FILENAME, renderReport } from './src/use-cases/dispute-report'
export {
  ARTIFACT_CHECKS,
  activityChecks,
  COMMANDS_SKIP,
  outputChecks,
} from './src/use-cases/output-checks'
export { plannedNames, stepsValid } from './src/use-cases/plan-gates'
export type { TRegressionRecord } from './src/use-cases/regression'
export { regressionNote, regressionVerdict } from './src/use-cases/regression'
