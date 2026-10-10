/**
 * Gates over a plan that something else will execute.
 *
 * The operator's envelope is the only one a machine consumes directly: its
 * `steps` become the chain that runs. That makes a wrong one qualitatively
 * different from a wrong paragraph — an invented step name is not a weak
 * recommendation, it is a run that cannot start.
 *
 * A prompt can ASK for valid step names. Only a gate can establish them, and
 * the failed checks go back to the same agent session as a correction, so the
 * operator gets one chance to fix its own plan before anyone sees it.
 */

import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate, TGateReport } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'
import { isStepName, STEP_NAMES } from '../../typedefs/step'

/** Steps the operator must never plan, with the reason the agent is told. */
const FORBIDDEN: Readonly<Record<string, string>> = {
  operator:
    'an operator cannot plan an operator — the second would replan the chain ' +
    'the first just chose',
}

/** The ordered step list a plan claims, with non-strings discarded. */
export const plannedNames = (envelope: TEnvelopeBase): readonly string[] => {
  const steps = (envelope as { steps?: unknown }).steps
  return Array.isArray(steps)
    ? steps.filter((step): step is string => typeof step === 'string')
    : []
}

/**
 * Every planned step exists, none is forbidden, and the plan is not empty.
 *
 * An empty plan is a failure rather than a no-op: the operator was asked
 * which steps achieve an outcome, and "none" is an answer it must argue for
 * in `unresolved`, not one it can give by returning nothing.
 */
export const stepsValid: TGate = {
  name: 'steps_valid',
  check: (envelope) => {
    const names = plannedNames(envelope)
    if (names.length === 0) {
      return addCheck(
        emptyReport,
        'plan',
        false,
        'no steps planned — a chain of nothing cannot produce an outcome. ' +
          'Name the steps the outcome needs, or say in `unresolved` why none apply.',
      )
    }
    return names.reduce<TGateReport>((report, name) => {
      const forbidden = FORBIDDEN[name]
      if (forbidden !== undefined) {
        return addCheck(report, name, false, forbidden)
      }
      return addCheck(
        report,
        name,
        isStepName(name),
        isStepName(name)
          ? 'a pi-crust step'
          : `not a pi-crust step. The steps are: ${STEP_NAMES.join(', ')}`,
      )
    }, emptyReport)
  },
}
