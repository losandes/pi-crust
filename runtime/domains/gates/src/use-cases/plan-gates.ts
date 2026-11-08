/**
 * Gates over a plan that something else will execute.
 *
 * The operator's envelope is the only one a machine consumes directly: its
 * `activities` become the chain that runs. That makes a wrong one qualitatively
 * different from a wrong paragraph — an invented activity name is not a weak
 * recommendation, it is a run that cannot start.
 *
 * A prompt can ASK for valid activity names. Only a gate can establish them, and
 * the failed checks go back to the same agent session as a correction, so the
 * operator gets one chance to fix its own plan before anyone sees it.
 */

import type {
  TEnvelopeBase,
  TGate,
  TGateReport,
} from '../../../../lib/contracts'
import {
  addCheck,
  emptyReport,
  isPlannerName,
  PLANNER_NAMES,
} from '../../../../lib/contracts'

/**
 * A Planner may never be planned, and the agent is told why.
 *
 * `operator` is the obvious case — the second would replan the chain the
 * first just chose — and `triage` is the same mistake with the answer handed
 * back instead. Neither is an Activity, so neither is nameable in a plan.
 */
const forbidden = (name: string): string | undefined =>
  isPlannerName(name)
    ? `'${name}' is a Planner, not an Activity — a Planner cannot plan a ` +
      `Planner. The Planners are ${PLANNER_NAMES.join(', ')}.`
    : undefined

/** The ordered activity list a plan claims, with non-strings discarded. */
export const plannedNames = (envelope: TEnvelopeBase): readonly string[] => {
  // `steps` is the operator's envelope field, a wire contract with the
  // prompts and with every trace already written. The vocabulary here is
  // Activities; the field keeps the name the envelope published.
  const activities = (envelope as { steps?: unknown }).steps
  return Array.isArray(activities)
    ? activities.filter(
        (activity): activity is string => typeof activity === 'string',
      )
    : []
}

/**
 * Every planned Activity exists, none is a Planner, and the plan is not empty.
 *
 * Checked against the registry the RUN loaded, because Activities are
 * configuration: what exists is whatever `crust.activities.yaml` turned out
 * to hold, and a gate holding its own list would be the hardcoding this
 * whole refactor removed.
 *
 * An empty plan is a failure rather than a no-op: the Planner was asked
 * which Activities achieve an outcome, and "none" is an answer it must
 * argue for in `unresolved`, not one it can give by returning nothing.
 */
export const stepsValid: TGate = {
  name: 'steps_valid',
  check: (envelope, run) => {
    const offered = run.cfg.activities.map((one) => one.name)
    const names = plannedNames(envelope)
    if (names.length === 0) {
      return addCheck(
        emptyReport,
        'plan',
        false,
        'no activities planned — a chain of nothing cannot produce an outcome. ' +
          'Name the activities the outcome needs, or say in `unresolved` why none apply.',
      )
    }
    return names.reduce<TGateReport>((report, name) => {
      const refusal = forbidden(name)
      if (refusal !== undefined) {
        return addCheck(report, name, false, refusal)
      }
      const known = offered.includes(name)

      return addCheck(
        report,
        name,
        known,
        known
          ? 'an Activity this repository offers'
          : 'not an Activity this repository offers. They are: ' +
              `${offered.join(', ')}`,
      )
    }, emptyReport)
  },
}
