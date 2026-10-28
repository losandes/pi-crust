/**
 * Gates over what an envelope CLAIMED — never over a guess.
 *
 * A gate is `gate(envelope, run) -> TGateReport`, one check per item it looked
 * at. Violations are derived from the failed checks and sent back to the SAME
 * agent session as a correction. Every check is recorded either way, so a green
 * gate says WHAT it verified instead of only that it passed.
 */

import { isAbsolute, join } from 'node:path'
import { fileExists, humanSize, isFile, readText } from '../../data/files'
import { resolveClaim } from '../../data/roots'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate, TGateReport } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'
import { safeParseSettlement } from '../../typedefs/settlement'
import { WARNING_EVENT, warningPayload } from '../../typedefs/warning'

const claimedChangedFiles = (envelope: TEnvelopeBase): readonly string[] => {
  const claimed = (envelope as { changed_files?: unknown }).changed_files
  return Array.isArray(claimed)
    ? claimed.filter((f) => typeof f === 'string')
    : []
}

/**
 * Resolve a claimed path against the repository the run is about, not the
 * orchestrator's own cwd — workspace-first (the behaviour commit `49b2ab0`
 * landed), then VCS-root-wide (what this spec adds).
 *
 * `run.repoRoot` is the directory every agent was actually spawned to work
 * in; absent on a TRun built without one, as a test double might, this falls
 * back to `process.cwd()` and treats the VCS root as equal to it, which is
 * the honest answer for a tree this function knows nothing else about.
 *
 * A resolved claim is reported as this gate's `note`, naming which root
 * answered (1.3.2). A claim that resolves only against the VCS root also
 * raises a warning naming the path (1.3.3) — never a failure, because a
 * monorepo workspace may legitimately own work that lives above it.
 */
const resolve = (
  run: TRun,
  path: string,
): Readonly<{ target: string; note: string }> => {
  const workspaceRoot = run.repoRoot || process.cwd()
  const vcsRoot = run.vcsRoot || workspaceRoot
  const resolved = resolveClaim({ workspaceRoot, vcsRoot }, path)
  if (resolved === undefined) {
    return {
      target: isAbsolute(path) ? path : join(workspaceRoot, path),
      note: '',
    }
  }
  if (resolved.root === 'vcs' && !isAbsolute(path)) {
    const activityRun = run.activityRuns().at(-1)
    run.tracer.event({
      run_id: run.runId,
      activity_run_id: activityRun?.activity_run_id ?? '',
      type: 'log',
      name: WARNING_EVENT,
      payload: warningPayload({
        kind: 'outside_workspace',
        activities: activityRun === undefined ? [] : [activityRun.params.name],
        activityRunIds:
          activityRun === undefined ? [] : [activityRun.activity_run_id],
        stage: activityRun?.params.name ?? '',
        paths: [path],
        note:
          `resolved against the VCS root at ${vcsRoot}, not the ` +
          `workspace at ${workspaceRoot}`,
      }),
    })
  }

  return {
    target: resolved.path,
    note: resolved.root === 'workspace' ? '(workspace)' : '(vcs)',
  }
}

export const artifactsExist: TGate = {
  name: 'artifacts_exist',
  check: (envelope, run) =>
    envelope.artifacts.reduce<TGateReport>((report, path) => {
      const { target, note } = resolve(run, path)
      return addCheck(
        report,
        path,
        fileExists(target),
        fileExists(target)
          ? `exists, ${humanSize(target)} ${note}`.trim()
          : 'declared artifact does not exist',
      )
    }, emptyReport),
}

export const filesNonEmpty: TGate = {
  name: 'files_non_empty',
  check: (envelope, run) =>
    envelope.artifacts.reduce<TGateReport>((report, path) => {
      const { target } = resolve(run, path)
      // existence is artifactsExist's job
      if (!isFile(target)) {
        return report
      }
      const empty = humanSize(target) === '0B'
      return addCheck(
        report,
        path,
        !empty,
        empty ? 'declared artifact is empty' : humanSize(target),
      )
    }, emptyReport),
}

export const jsonParses: TGate = {
  name: 'json_parses',
  check: (envelope, run) =>
    envelope.artifacts.reduce<TGateReport>((report, path) => {
      const { target } = resolve(run, path)
      if (!(path.endsWith('.json') && fileExists(target))) {
        return report
      }
      const parsed = safeParseSettlement<unknown>(() =>
        JSON.parse(readText(target)),
      )
      return parsed.status === 'ok'
        ? addCheck(
            report,
            path,
            true,
            `parses, ${Array.isArray(parsed.data) ? 'array' : typeof parsed.data}`,
          )
        : addCheck(
            report,
            path,
            false,
            `declared JSON artifact does not parse: ${parsed.error.message}`,
          )
    }, emptyReport),
}

/** Every file claimed changed must exist on disk. */
export const diffMatchesClaims: TGate = {
  name: 'diff_matches_claims',
  check: (envelope, run) =>
    claimedChangedFiles(envelope).reduce<TGateReport>((report, path) => {
      const { target, note } = resolve(run, path)
      return addCheck(
        report,
        path,
        fileExists(target),
        fileExists(target)
          ? `exists, ${humanSize(target)} ${note}`.trim()
          : 'claimed changed file does not exist',
      )
    }, emptyReport),
}

/**
 * A diagnosis must be able to show its work.
 *
 * Three claims that cost nothing to check and everything to get wrong:
 *
 *   - `reproduced: true` with no activities is a reproduction nobody else can run,
 *     which is indistinguishable from one that never happened.
 *   - `confidence: "confirmed"` without a reproduction is the exact confusion
 *     this stage exists to stop — a cause reasoned about, labelled as found.
 *   - `reproduced: false` with no unresolved question asks nobody for the
 *     thing that would make progress possible, so the run ends quietly rather
 *     than escalating.
 *
 * What it deliberately does NOT check is whether the cause is right. Nothing
 * mechanical can, which is why the fields exist for a human to read.
 */
export const reproductionSupported: TGate = {
  name: 'reproduction_supported',
  check: (envelope) => {
    const claim = envelope as Readonly<{
      reproduced?: boolean
      steps_to_reproduce?: readonly string[]
      confidence?: string
      unresolved?: readonly unknown[]
    }>
    const reproduced = claim.reproduced === true
    const activities = claim.steps_to_reproduce ?? []
    const unresolved = claim.unresolved ?? []

    const withSteps = addCheck(
      emptyReport,
      'steps_to_reproduce',
      !reproduced || activities.length > 0,
      reproduced
        ? `${activities.length} activity(s) recorded`
        : 'not reproduced, so no activities are required',
    )
    const withConfidence = addCheck(
      withSteps,
      'confidence',
      claim.confidence !== 'confirmed' || reproduced,
      claim.confidence === 'confirmed' && !reproduced
        ? 'confirmed without a reproduction — a cause you reasoned to is at most likely'
        : `confidence: ${claim.confidence ?? '(none)'}`,
    )
    return addCheck(
      withConfidence,
      'escalation',
      reproduced || unresolved.length > 0,
      reproduced
        ? 'reproduced, so nothing needs asking'
        : 'could not reproduce and asked nobody — say what you would need in unresolved',
    )
  },
}
