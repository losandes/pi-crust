import type { GateResult } from '../typedefs/activity-run'

export type TGatesVerdict = 'passed' | 'failed'

/**
 * The overall result of the gate results listed for one activity run.
 * Undefined when none is listed: no gate having run is not a pass.
 */
export const deriveGatesVerdict = (
  gates: readonly Readonly<Pick<GateResult, 'passed'>>[],
): TGatesVerdict | undefined => {
  if (gates.length === 0) return undefined
  return gates.every((gate) => Boolean(gate.passed)) ? 'passed' : 'failed'
}
