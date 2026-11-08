/** Acceptance — gates, disputes, regressions */

export { checks } from './src/use-cases/checks-gate'
export { diffMatchesClaims } from './src/use-cases/claim-gates'
export { disputesSupported } from './src/use-cases/dispute-gates'
export type { TRoundRecord } from './src/use-cases/dispute-ledger'
export {
  readLedger,
  roundRecord,
  unmovedFindings,
  writeLedger,
} from './src/use-cases/dispute-ledger'
export { REPORT_FILENAME, renderReport } from './src/use-cases/dispute-report'
export {
  GATE_CATALOGUE,
  GATE_NAMES,
  gateNamed,
} from './src/use-cases/gate-registry'
export { plannedNames, stepsValid } from './src/use-cases/plan-gates'
export type { TRegressionRecord } from './src/use-cases/regression'
export { regressionNote, regressionVerdict } from './src/use-cases/regression'
