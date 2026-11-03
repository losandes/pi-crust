/**
 * The counting the harness does, so neither agent decides when to stop.
 *
 * One record per review round: what the reviewer called blocking, the evidence
 * it attached, what the revise before it disputed and with what, and how many
 * files that revise claimed. A finding that reappears with nothing new on
 * either side is a disagreement nobody is going to settle, and the loop ends
 * on it rather than paying for another build-sized call.
 *
 * Pure: everything here is text comparison over records the loop hands it.
 * Plain objects rather than `Map`, because the ledger is persisted as JSON —
 * and it MUST be, since `agentStep`'s replay reads one `envelope.json` per
 * agent, so on `--resume` two review rounds hand back the same object and a
 * ledger rebuilt from envelopes would read as a false deadlock.
 */

import { join } from 'node:path'
import { z } from 'zod'
import {
  errorMessage,
  safeParseSettlement,
} from '../../../lib/typedefs/src/settlement'
import { isFile, readText, writeText } from '../data/files'
import { normalise } from '../typedefs/dispute'
import type { TBuildOutput, TReviewOutput } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'

/**
 * The ledger's shape, as a schema rather than only a type.
 *
 * It is read back off disk on `--resume`, which makes it a boundary, and this
 * repository parses boundaries. The stakes are higher than the usual: these
 * records are what decides whether a disagreement is a deadlock, so a stale or
 * hand-edited file could stop a loop that was progressing or keep paying for
 * one that never will.
 */
export const roundRecordSchema = z.object({
  round: z.number().int().positive(),
  blocking: z.array(z.string()),
  evidence: z.record(z.string(), z.string()),
  disputes: z.record(z.string(), z.string()),
  changed: z.number().int().nonnegative(),
})

export const ledgerSchema = z.array(roundRecordSchema)

export type TRoundRecord = Readonly<{
  /** 1 is the chain's own review, 2 the first re-review, ... */
  round: number
  /** normalised blocking items, in the order the reviewer gave them */
  blocking: readonly string[]
  /** normalised finding -> the normalised evidence the reviewer attached */
  evidence: Readonly<Record<string, string>>
  /** normalised finding -> the normalised evidence the preceding revise disputed it with */
  disputes: Readonly<Record<string, string>>
  /** how many files that revise claimed to change */
  changed: number
}>

const evidenceFor = (review: TReviewOutput, blocking: string): string => {
  const match = review.findings.find(
    (finding) => normalise(finding.requirement) === blocking,
  )
  return normalise(match?.evidence ?? '')
}

/**
 * The evidence the first reviewer to attach any gave for one finding.
 *
 * A finding two reviewers both raised is one finding: the loop asks whether
 * it MOVED between rounds, and reading two answers for it would make the
 * question unanswerable.
 */
const evidenceIn = (
  reviews: readonly TReviewOutput[],
  blocking: string,
): string =>
  reviews.map((review) => evidenceFor(review, blocking)).find(Boolean) ?? ''

/**
 * One review round, reduced to the text the repeat count turns on.
 *
 * A round re-asks every review the chain ended in, so a record folds all of
 * their verdicts: one record per round, whether one reviewer ruled or three.
 * Counting a round per reviewer would make two reviewers look like a
 * disagreement progressing when neither had moved.
 */
export const roundRecord = (
  params: Readonly<{
    round: number
    reviews: readonly TReviewOutput[]
    revise: TBuildOutput | undefined
  }>,
): TRoundRecord => {
  // `blocking` is the authority on what is blocking; `findings` only supplies
  // the evidence for it.
  const blocking = [
    ...new Set(
      params.reviews.flatMap((review) =>
        review.blocking.map(normalise).filter(Boolean),
      ),
    ),
  ]
  return {
    round: params.round,
    blocking,
    evidence: Object.fromEntries(
      blocking.map((item) => [item, evidenceIn(params.reviews, item)]),
    ),
    disputes: Object.fromEntries(
      (params.revise?.disputes ?? []).map((dispute) => [
        normalise(dispute.finding),
        normalise(dispute.evidence),
      ]),
    ),
    changed: params.revise?.changed_files.length ?? 0,
  }
}

/**
 * Findings both rounds blocked on with nothing new from either side.
 *
 * A reviewer that restated its evidence has moved; so has a builder that
 * disputed with different evidence, and so has one that edited a file at all —
 * arguing is not the only way to answer a finding. What is left is a verbatim
 * repeat against a revise that neither changed anything nor said anything new,
 * which is the case this ends.
 */
export const unmovedFindings = (
  previous: TRoundRecord,
  current: TRoundRecord,
): readonly string[] => {
  if (current.changed > 0) {
    return []
  }
  const before = new Set(previous.blocking)
  return current.blocking.filter(
    (finding) =>
      before.has(finding) &&
      current.evidence[finding] === previous.evidence[finding] &&
      current.disputes[finding] === previous.disputes[finding],
  )
}

export const LEDGER_FILENAME = 'disputes.json'

export const ledgerPath = (run: TRun): string =>
  join(run.contextHandoffDir, LEDGER_FILENAME)

/**
 * The persisted rounds, or none when the file cannot be trusted.
 *
 * Parsed rather than cast. This ledger decides when a disagreement becomes a
 * deadlock and when the developer is escalated to, so a file left by an older
 * schema, or edited by hand between resumes, must not be read as if it were
 * current. A ledger that will not parse is treated as absent and said out loud,
 * which costs at most one extra revise round and never a wrong verdict.
 */
export const readLedger = (run: TRun): readonly TRoundRecord[] => {
  const path = ledgerPath(run)
  if (!isFile(path)) {
    return []
  }
  const settled = safeParseSettlement(() =>
    ledgerSchema.parse(JSON.parse(readText(path))),
  )
  if (settled.status === 'error') {
    run.console.note(
      `ignoring an unreadable dispute ledger at ${path}: ${errorMessage(settled.error)}`,
    )
    return []
  }
  return settled.data
}

export const writeLedger = (
  run: TRun,
  rounds: readonly TRoundRecord[],
): void => {
  writeText(ledgerPath(run), `${JSON.stringify(rounds, null, 2)}\n`)
}
