/**
 * Gates over what an envelope CLAIMED — never over a guess.
 *
 * A gate is `gate(envelope, run) -> TGateReport`, one check per item it looked
 * at. Violations are derived from the failed checks and sent back to the SAME
 * agent session as a correction. Every check is recorded either way, so a green
 * gate says WHAT it verified instead of only that it passed.
 */

import { fileExists, humanSize, isFile, readText } from '../../data/files'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate, TGateReport } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'
import { safeParseSettlement } from '../../typedefs/settlement'

const claimedChangedFiles = (envelope: TEnvelopeBase): readonly string[] => {
  const claimed = (envelope as { changed_files?: unknown }).changed_files
  return Array.isArray(claimed)
    ? claimed.filter((f) => typeof f === 'string')
    : []
}

export const artifactsExist: TGate = {
  name: 'artifacts_exist',
  check: (envelope) =>
    envelope.artifacts.reduce<TGateReport>(
      (report, path) =>
        addCheck(
          report,
          path,
          fileExists(path),
          fileExists(path)
            ? `exists, ${humanSize(path)}`
            : 'declared artifact does not exist',
        ),
      emptyReport,
    ),
}

export const filesNonEmpty: TGate = {
  name: 'files_non_empty',
  check: (envelope) =>
    envelope.artifacts.reduce<TGateReport>((report, path) => {
      // existence is artifactsExist's job
      if (!isFile(path)) {
        return report
      }
      const empty = humanSize(path) === '0B'
      return addCheck(
        report,
        path,
        !empty,
        empty ? 'declared artifact is empty' : humanSize(path),
      )
    }, emptyReport),
}

export const jsonParses: TGate = {
  name: 'json_parses',
  check: (envelope) =>
    envelope.artifacts.reduce<TGateReport>((report, path) => {
      if (!(path.endsWith('.json') && fileExists(path))) {
        return report
      }
      const parsed = safeParseSettlement<unknown>(() =>
        JSON.parse(readText(path)),
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
  check: (envelope) =>
    claimedChangedFiles(envelope).reduce<TGateReport>(
      (report, path) =>
        addCheck(
          report,
          path,
          fileExists(path),
          fileExists(path)
            ? `exists, ${humanSize(path)}`
            : 'claimed changed file does not exist',
        ),
      emptyReport,
    ),
}

/**
 * A diagnosis must be able to show its work.
 *
 * Three claims that cost nothing to check and everything to get wrong:
 *
 *   - `reproduced: true` with no steps is a reproduction nobody else can run,
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
    const steps = claim.steps_to_reproduce ?? []
    const unresolved = claim.unresolved ?? []

    const withSteps = addCheck(
      emptyReport,
      'steps_to_reproduce',
      !reproduced || steps.length > 0,
      reproduced
        ? `${steps.length} step(s) recorded`
        : 'not reproduced, so no steps are required',
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
