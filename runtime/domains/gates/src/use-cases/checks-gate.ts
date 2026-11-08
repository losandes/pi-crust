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
 * declared rule that matches nothing PASSES too, by default (issue #2,
 * 1.1.1) — it is a gap rather than an abstention, but a repository's first
 * uncovered change failing outright taught a build agent nothing it could
 * act on, only that it had met a gate it could not pass and could not fix.
 * The gap still rides back, named, as a passing check and a run warning
 * (`routing.unmatched: "block"` turns it into a real failure for a
 * repository that wants that instead).
 *
 * Declared per Activity rather than applied to all of them, because
 * automatic gating fails in both directions. After `test` the suite is red on
 * purpose — that is TDD order, not a defect. After `plan` the only change is
 * a markdown file, and a reporting gap there is no more a failure than it is
 * anywhere else. Both are failures of AUTOMATIC gating; declaring it where it
 * belongs resolves them.
 *
 * Every command comes from `routing.checks` in the config. This file names no
 * test runner and no linter, because crust is stamped into repositories whose
 * toolchain it cannot know.
 */

import type {
  TEnvelopeBase,
  TGate,
  TGateReport,
  TRun,
} from '../../../../lib/contracts'
import {
  addCheck,
  buildOutput,
  emptyReport,
  narrowEnvelope,
  WARNING_EVENT,
  warningPayload,
} from '../../../../lib/contracts'
import { NOTHING_DECLARED, runVerification } from '../../../policy'
import { changedFiles, untrackedFiles } from '../../../workspace'
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

/**
 * A gap `routing.checks` left in THIS change, reported to the run as a
 * warning — a separate channel from the gate's own verdict, because the gate
 * holds by default (1.1.1) and a passing gate still owes the reader the
 * reason it is passing rather than silence that would read as coverage.
 */
const reportGap = (run: TRun, paths: readonly string[]): void => {
  if (paths.length === 0) {
    return
  }
  const activityRun = run.activityRuns().at(-1)
  run.tracer.event({
    run_id: run.runId,
    activity_run_id: activityRun?.activity_run_id ?? '',
    type: 'log',
    name: WARNING_EVENT,
    payload: warningPayload({
      kind: 'unverified',
      activities: activityRun === undefined ? [] : [activityRun.params.name],
      activityRunIds:
        activityRun === undefined ? [] : [activityRun.activity_run_id],
      stage: activityRun?.params.name ?? '',
      paths,
      note: 'no routing.checks rule matched these paths',
    }),
  })
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
  const withMatched = result.checks.reduce<TGateReport>(
    (report, check) =>
      addCheck(
        report,
        check.name,
        check.passed,
        check.passed
          ? `\`${check.command}\` exited 0`
          : `\`${check.command}\` exited ${check.returncode}\n${check.outputTail}`.trimEnd(),
      ),
    result.checks.length === 0 && paths.length === 0
      ? addCheck(emptyReport, 'routing.checks', true, 'nothing changed')
      : emptyReport,
  )

  if (result.unmatchedPaths.length === 0) {
    return withMatched
  }

  /*
   * Declared and matched nothing (1.1.1, 1.1.3) or matched SOME of the
   * changed paths and left a remainder (1.1.4) -- either way the gap is
   * named, not swallowed by a partial match, and it is reported as both the
   * run's warning (for the end-of-run summary) and a passing check here,
   * unless the repository opted into `routing.unmatched: "block"`.
   */
  reportGap(run, result.unmatchedPaths)
  const blocked = run.cfg.routing.unmatched === 'block'

  return addCheck(
    withMatched,
    'routing.checks',
    !blocked,
    `${result.unmatchedPaths.length} path(s) changed with no matching rule: ` +
      result.unmatchedPaths.join(', '),
  )
}

export const checks: TGate = {
  name: 'checks',
  readsTree: true,
  check: (envelope, run, changedPaths) =>
    checksReport(run, checkedPaths(envelope, changedPaths)),
}
