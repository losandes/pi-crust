/**
 * Gates on the builder's disputes — the harness refusing to take a refusal.
 *
 * Nothing here decides who is right about the code. It checks the shape of the
 * disagreement: that the dispute says which finding it answers, that it carries
 * evidence somebody else could re-check, and that it is not arguing with a
 * command. A finding a declared check decides is not open to opinion — exit
 * status is not a matter of opinion — so disputing one fails here the same way
 * `verdict_consistent` fails an approval that ships blocking items.
 *
 * Which tasks exist is `tasks` in the config and nothing else, so
 * this file names no checker of any repository.
 */

import type {
  TEnvelopeBase,
  TGate,
  TGateReport,
  TRun,
} from '../../../../lib/contracts'
import { addCheck, emptyReport } from '../../../../lib/contracts'
import { hasEvidenceShape, namesWord, normalise } from '../typedefs/dispute'

type TDisputeShape = Readonly<{
  finding?: unknown
  evidence?: unknown
}>

const disputesOf = (envelope: TEnvelopeBase): readonly TDisputeShape[] => {
  const disputes = (envelope as Readonly<{ disputes?: unknown }>).disputes
  return Array.isArray(disputes)
    ? disputes.filter(
        (entry): entry is TDisputeShape =>
          entry !== null && typeof entry === 'object',
      )
    : []
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** The declared check this finding is about, or '' when it is about none. */
const decidedByCheck = (run: TRun, finding: string): string => {
  const names = Object.keys(run.cfg.tasks)
  return names.find((name) => namesWord(finding, name)) ?? ''
}

const checkDispute = (
  report: TGateReport,
  run: TRun,
  dispute: TDisputeShape,
  index: number,
): TGateReport => {
  const finding = text(dispute.finding).trim()
  const evidence = text(dispute.evidence).trim()
  const decider = finding === '' ? '' : decidedByCheck(run, normalise(finding))

  const named = addCheck(
    report,
    `dispute[${index}] names a finding`,
    finding !== '',
    finding === ''
      ? 'a dispute must quote the blocking item it answers'
      : `answers: ${finding.slice(0, 80)}`,
  )
  const supported = addCheck(
    named,
    `dispute[${index}] carries evidence`,
    hasEvidenceShape(evidence),
    hasEvidenceShape(evidence)
      ? `evidence: ${evidence.slice(0, 80)}`
      : 'a dispute needs a path:line or a command and its exit status — ' +
          'without one it is a refusal',
  )
  return addCheck(
    supported,
    `dispute[${index}] is open to judgement`,
    decider === '',
    decider === ''
      ? 'no declared check decides this finding'
      : `${decider} is decided by a command verify already ran — fix it; ` +
          'exit status is not a matter of opinion',
  )
}

/** A revise must answer the review with a rewrite or a supported dispute. */
export const disputesSupported: TGate = {
  name: 'disputes_supported',
  check: (envelope, run) => {
    const disputes = disputesOf(envelope)
    const changed = (envelope as Readonly<{ changed_files?: unknown }>)
      .changed_files
    const answered =
      disputes.length > 0 || (Array.isArray(changed) && changed.length > 0)

    return disputes.reduce(
      (report, dispute, index) => checkDispute(report, run, dispute, index),
      addCheck(
        emptyReport,
        'review answered',
        answered,
        answered
          ? 'reported a rewrite or a dispute'
          : 'a revise must report at least one changed file or a supported dispute',
      ),
    )
  },
}
