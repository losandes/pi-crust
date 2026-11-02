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
 * Which checks exist is `routing.checks` in the config and nothing else, so
 * this file names no checker of any repository.
 */

import { hasEvidenceShape, namesWord, normalise } from '../../typedefs/dispute'
import type { TEnvelopeBase } from '../../typedefs/envelope'
import type { TGate, TGateReport } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'
import type { TRun } from '../../typedefs/run'

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
  const names = run.cfg.routing.checks.map((check) => check.name)
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

/**
 * Every dispute in a build envelope must be one, not a refusal wearing the word.
 *
 * An envelope with no disputes passes vacuously and records nothing: a plain
 * build is not asked to justify an argument it never made.
 */
export const disputesSupported: TGate = {
  name: 'disputes_supported',
  check: (envelope, run) =>
    disputesOf(envelope).reduce(
      (report, dispute, index) => checkDispute(report, run, dispute, index),
      emptyReport,
    ),
}
