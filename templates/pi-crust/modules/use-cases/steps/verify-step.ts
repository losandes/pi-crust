/**
 * verify: run the deterministic checks the changed paths select.
 *
 * Every command it runs comes from `routing.checks` in the config — tests,
 * lint, typecheck, a repository's own convention checkers. None of them is
 * named in this file, because crust is stamped into repositories whose checkers
 * it cannot know.
 *
 * A failing check does NOT fail the phase. The runner did its job; the code is
 * what failed. The verdict travels on as `accepted: false` and as an envelope
 * the next agent can read, which is how a fix loop gets its spec.
 *
 * `--base` makes it judge committed work: given a ref or a range, the paths
 * come from that change rather than from the working tree, and an explicit
 * base outranks the builder's claim because the developer asked for it.
 */

import { changedFiles, untrackedFiles } from '../../data/git'
import type { TRangeSelection } from '../../typedefs/changes'
import type { TVerifyOutput } from '../../typedefs/envelope'
import { buildOutput, narrowEnvelope } from '../../typedefs/envelope'
import { phaseParams } from '../../typedefs/phase'
import type { TStep, TStepContext, TStepOptions } from '../../typedefs/step'
import { stepPhaseName } from '../../typedefs/step'
import { recordStepResult, replayStepResult } from '../resume'
import { runVerification, verificationEnvelope } from '../run-checks'
import { requireSelected, selectRange } from '../select-range'

/**
 * The base when one was given, else the builder's claim, else the working tree.
 *
 * An explicit base outranks the claim: the developer named the change to judge,
 * and the builder's claim may describe a different one entirely.
 */
export const verifiablePaths = (
  ctx: TStepContext,
  selection: TRangeSelection,
): readonly string[] => {
  if (selection.spec !== '') {
    return requireSelected(selection)
  }
  const claimed = narrowEnvelope(buildOutput, ctx.previous)?.changed_files
  return claimed !== undefined && claimed.length > 0
    ? [...claimed].toSorted()
    : [...changedFiles(), ...untrackedFiles()].filter(Boolean).toSorted()
}

const replayedEnvelope = (
  passed: boolean,
  failures: readonly string[],
): TVerifyOutput => ({
  status: passed ? 'success' : 'fail',
  summary: passed
    ? 'verification: replayed from this session — all checks passed'
    : `verification: replayed from this session — ${failures.length} failure(s)`,
  artifacts: [],
  notes_for_next_agent: passed ? '' : 'Fix every failure below.',
  passed,
  failures: [...failures],
})

export const verifyStep = (options: TStepOptions): TStep => {
  const phaseName = stepPhaseName('verify', options.instance)
  return {
    name: 'verify',
    params: phaseParams({
      name: phaseName,
      kind: 'code',
      owner: 'checks',
      description:
        'Run the checks the changed paths select — the repository says which, not crust',
    }),
    requires: [],

    execute: (ctx, handle) => {
      const selection = selectRange(options.base)
      const paths = verifiablePaths(ctx, selection)
      const result = runVerification(ctx.run, paths)
      const passed = result.checks.filter((check) => check.passed).length
      handle.log({
        passed: result.passed,
        base: options.base || '(working tree)',
        reason: selection.reason,
        paths: paths.length,
        checks: `${passed}/${result.checks.length}`,
        artifacts: result.artifacts.join(', '),
      })
      // The verdict, filed under its own event name so replay reads what the
      // suite decided and never what the phase's status implies.
      recordStepResult(ctx.run, handle, {
        passed: result.passed,
        failures: [...result.failures],
        checks: result.checks.length,
        changed_paths: paths.length,
        base: options.base,
        base_reason: selection.reason,
      })
      return Promise.resolve({
        previous: verificationEnvelope(result, paths.length),
        accepted: result.passed,
      })
    },

    replay: (ctx) => {
      const payload = replayStepResult(ctx.run, phaseName)
      if (payload === undefined) {
        throw new Error(
          `cannot resume phase '${phaseName}': this session recorded no ` +
            'verification verdict. Drop --resume so the checks run again.',
        )
      }
      const passed = payload.passed === true
      const failures = Array.isArray(payload.failures)
        ? (payload.failures as readonly string[])
        : []
      return Promise.resolve({
        previous: replayedEnvelope(passed, failures),
        accepted: passed,
      })
    },
  }
}
