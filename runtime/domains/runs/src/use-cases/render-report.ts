import type { TGateOutcome, TRunState } from '../../../../lib/contracts'
import {
  importOutput,
  importOutputSchema,
  renderWarnings,
} from '../../../../lib/contracts'
import { box, paint } from '../../../../lib/terminal'
import {
  crustArgv,
  displayLabel,
  RUN_RECIPE,
  recipeArgv,
  resumeArgv,
  shellLine,
} from '../../../cli'
import { renderImportReport } from '../../../imports'

export const MARKS: Readonly<Record<string, string>> = {
  success: '✓',
  fail: '✗',
  running: '·',
  queued: '·',
}

export const gateLines = (gate: TGateOutcome): readonly string[] => [
  paint(`    gate ${gate.gate} failed`, 'red'),
  ...gate.violations.map((violation) => `      - ${violation}`),
]

/**
 * The command that picks this run back up, in the words the developer types.
 *
 * Read from what the run RECORDED, not reconstructed from the session row.
 * The row holds the entry point's own name and nothing else, so a line built
 * from it drops `--lifecycle sdlc`, `--approve-after plan` and every other
 * flag the run was started with — and the resulting command either refuses
 * for want of a chain or quietly runs a different one.
 */
export const resumeCommand = (
  state: TRunState,
  invocation: readonly string[] | undefined,
): string => {
  // `resumeArgv` answers script-first; `recipeArgv` reads a full `bun <script>`
  // line, which is the shape everything else records.
  const resumed =
    invocation === undefined
      ? undefined
      : recipeArgv(['bun', ...resumeArgv(invocation, state.run_id)])
  if (resumed !== undefined) {
    return shellLine(resumed)
  }
  const request = state.request.split('\n')[0] ?? ''

  return shellLine(
    crustArgv(RUN_RECIPE, [request, '--run-id', state.run_id, '--resume']),
  )
}

export const renderReport = (
  state: TRunState,
  invocation: readonly string[] | undefined = undefined,
): string => {
  const header = [
    `${paint('run_id:', 'bold')} ${state.run_id}`,
    `${paint('workflow:', 'bold')} ${displayLabel(state.name, state.lifecycle || '(unknown)')}`,
    /*
     * A name shown instead of the lifecycle still leaves the lifecycle
     * discoverable — the data stays in `sessions.lifecycle`, this just
     * prints it one line down rather than letting it hide behind the label.
     */
    ...(state.name
      ? [`${paint('lifecycle:', 'bold')} ${state.lifecycle || '(unknown)'}`]
      : []),
    `${paint('status:', 'bold')} ${state.status}`,
    `${paint('engineer:', 'bold')} ${state.engineer}`,
    `${paint('tokens:', 'bold')} ${state.tokens.toLocaleString('en-US')}` +
      `   ${paint('cost:', 'bold')} $${state.cost.toFixed(4)}`,
  ]
  const activityRuns = state.activityRuns.flatMap((activityRun) => [
    `  ${MARKS[activityRun.status] ?? '·'} ${activityRun.seq.toString().padStart(2, '0')} ` +
      `${activityRun.name.padEnd(16)} ${activityRun.kind.padEnd(9)} ${activityRun.owner.padEnd(12)}` +
      ` ${activityRun.status}`,
    ...(activityRun.error ? [paint(`      ${activityRun.error}`, 'red')] : []),
    ...activityRun.gates.filter((gate) => !gate.passed).flatMap(gateLines),
  ])
  /*
   * Keyed on `resumable`, not on `resume_from === undefined`: a run that died
   * between Activities has no row for the ones it never reached, so
   * `resume_from` alone would print the green line over a `status: fail`
   * header — the same disagreement `--resume` used to make with this report.
   */
  const tail = state.resumable
    ? state.resume_from === undefined
      ? [
          `  ${resumeCommand(state, invocation)}`,
          paint(
            'the run did not finish, even though every activity run it recorded was green',
            'yellow',
          ),
        ]
      : [
          `${paint('resume from:', 'bold')} ${state.resume_from}`,
          `  ${resumeCommand(state, invocation)}`,
        ]
    : [paint('every activity run succeeded — nothing to resume', 'green')]
  /*
   * What the run saw and could not attribute, reported here as well as in the
   * terminal that ran it. A developer asking a finished run what happened is
   * usually not the person who watched it happen.
   */
  const warnings = renderWarnings(state.warnings)
  const imported = state.envelopes
    .filter(
      (envelope) =>
        envelope.valid && envelope.output_type === importOutput.name,
    )
    .flatMap((envelope) => {
      const parsed = importOutputSchema.safeParse(envelope.payload)
      return parsed.success ? [parsed.data] : []
    })
    .at(-1)

  return [
    box('run', header, state.resumable ? 'yellow' : 'green'),
    '',
    ...(activityRuns.length > 0
      ? activityRuns
      : ['  (no activityRuns recorded)']),
    '',
    ...(imported === undefined ? [] : [...renderImportReport(imported), '']),
    ...(warnings.length > 0
      ? [...warnings.map((line) => paint(line, 'yellow')), '']
      : []),
    ...tail,
  ].join('\n')
}
