/** Deterministic quality blocks: one command, one captured result. */

export const QUALITY_AREAS = ['frontend', 'backend'] as const
export const QUALITY_OPERATIONS = [
  'lint',
  'typecheck',
  'build',
  'test',
] as const

export type TQualityArea = (typeof QUALITY_AREAS)[number]
export type TQualityOperation = (typeof QUALITY_OPERATIONS)[number]

/** One deterministic quality command. */
export type TQualityCheckSpec = Readonly<{
  name: string
  area: TQualityArea
  operation: TQualityOperation
  argv: readonly string[]
  timeoutSeconds: number
  /** relative to the repo root; empty runs at the root */
  cwd: string
}>

/** Captured evidence from one quality command. */
export type TQualityCheckResult = Readonly<{
  name: string
  area: TQualityArea
  operation: TQualityOperation
  command: string
  returncode: number
  passed: boolean
  durationSeconds: number
  outputArtifact: string
  // The tail of stdout+stderr, verbatim and unparsed. A failure has to travel
  // back to the builder as an envelope, and the builder cannot open a log file
  // it was never handed — so the evidence rides along. Deliberately raw: every
  // runner formats failures differently and a generic parser would be
  // confidently wrong. The full log is always at outputArtifact.
  outputTail: string
}>

/** Aggregate result from a quality block: every check it ran, and the verdict. */
export type TQualityResult = Readonly<{
  passed: boolean
  checks: readonly TQualityCheckResult[]
  failures: readonly string[]
  artifacts: readonly string[]
}>
