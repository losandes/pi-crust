/**
 * `checks`: the repository's own commands, as a gate.
 *
 * It used to be an Activity — `verify` — which produced a verdict nothing
 * consumed: no code read its envelope, and the revise loop keyed on `review`
 * and `code-review` alone. What it actually does is decide whether an
 * Activity's work holds, which is what a gate is.
 *
 * A repository that has declared no checks at all passes this gate, saying
 * so. `checks: []` is what an install stamps and the file holding it is
 * protected from the agents, so failing on it made the shipped configuration
 * unrunnable by construction. Declaring a rule is the act of opting in; a
 * declared rule that matches nothing still fails, because that is a gap
 * rather than an abstention.
 *
 * Declared per Activity rather than applied to all of them, because
 * automatic gating fails in both directions. After `test` the suite is red on
 * purpose — that is TDD order, not a defect. After `plan` the only change is
 * a markdown file, and `run-checks` treats "paths changed and no rule matched
 * them" as a failure rather than a no-op. Both are failures of AUTOMATIC
 * gating; declaring it where it belongs resolves them.
 *
 * Every command comes from `routing.checks` in the config. This file names no
 * test runner and no linter, because crust is stamped into repositories whose
 * toolchain it cannot know.
 */

import { changedFiles, untrackedFiles } from '../../data/git'
import { buildOutput, narrowEnvelope } from '../../typedefs/envelope'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate, TGateReport } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import { NOTHING_DECLARED, runVerification } from '../run-checks'

/**
 * What the checks are run about: what the driver says changed, else the
 * Activity's own claim, else the working tree.
 *
 * The driver's set wins because it is observed — `enforce-permissions`
 * reports the paths an Activity actually touched — and an agent's claim is a
 * claim. The working tree is the fallback for a gate asked to rule with
 * neither.
 */
export const checkedPaths = (
  envelope: TEnvelopeBase,
  changed: readonly string[],
): readonly string[] => {
  if (changed.length > 0) {
    return [...changed].toSorted()
  }
  const claimed = narrowEnvelope(buildOutput, envelope)?.changed_files
  return claimed !== undefined && claimed.length > 0
    ? [...claimed].toSorted()
    : [...changedFiles(), ...untrackedFiles()].filter(Boolean).toSorted()
}

export const checksReport = (
  run: TRun,
  paths: readonly string[],
): TGateReport => {
  /*
   * A repository that has declared nothing passes, and the gate SAYS it
   * passed for want of anything to run. Silence would read as coverage.
   */
  if (run.cfg.routing.checks.length === 0) {
    return addCheck(emptyReport, 'routing.checks', true, NOTHING_DECLARED)
  }
  const result = runVerification(run, paths)
  if (result.checks.length === 0) {
    return result.failures.reduce<TGateReport>(
      (report, failure) => addCheck(report, 'routing.checks', false, failure),
      paths.length === 0
        ? addCheck(emptyReport, 'routing.checks', true, 'nothing changed')
        : emptyReport,
    )
  }

  return result.checks.reduce<TGateReport>(
    (report, check) =>
      addCheck(
        report,
        check.name,
        check.passed,
        check.passed
          ? `\`${check.command}\` exited 0`
          : `\`${check.command}\` exited ${check.returncode}\n${check.outputTail}`.trimEnd(),
      ),
    emptyReport,
  )
}

export const checks: TGate = {
  name: 'checks',
  readsTree: true,
  check: (envelope, run, changedPaths) =>
    checksReport(run, checkedPaths(envelope, changedPaths)),
}
