import type { TActivityContext, TRun, TUnit } from '../../../../lib/contracts'
import {
  activityNamed,
  activityNameFromRun,
  activitySuccession,
  ENVELOPE_NAMES,
  envelopeNamed,
} from '../../../../lib/contracts'
import { readHistoryEnvelope } from '../../../activities'
import { readRunState } from '../../../trace'

/**
 * Rebuild the run's history before replaying its configured chain.
 *
 * The trace supplies provenance and first-production order; session files
 * supply the latest persisted envelopes. Numbered instances share their
 * Activity's entry, while an engine-named reviser retains its own name.
 * Seeding here also preserves work from before a resumed sub-chain.
 */
export const replayEnvelopeHistory = (
  run: Readonly<Pick<TRun, 'cfg' | 'tracer' | 'runId' | 'sessionDir'>>,
  units: readonly TUnit[] = [],
): Pick<TActivityContext, 'previous' | 'previousStep' | 'upstream'> => {
  const state = readRunState(run.tracer.dbPath, run.runId)
  const produced = (state?.activityRuns ?? []).flatMap((activityRun) => {
    if (activityRun.kind !== 'agent') {
      return []
    }
    const recorded = state?.envelopes.findLast(
      (one) =>
        one.valid &&
        one.activityRun === activityRun.name &&
        one.agent === activityRun.owner,
    )
    if (activityRun.status !== 'success' && recorded === undefined) {
      return []
    }
    const config = activityNamed(run.cfg.activities, activityRun.owner)
    const spec =
      envelopeNamed(config?.output ?? '') ??
      ENVELOPE_NAMES.map(envelopeNamed).find(
        (one) => one !== undefined && one.name === recorded?.output_type,
      )
    if (spec === undefined) {
      return []
    }
    return [
      {
        activity: activityNameFromRun(activityRun),
        runName: activityRun.name,
        agent: activityRun.owner,
        spec,
      },
    ]
  })
  const latest = [
    ...new Map(produced.map((one) => [one.activity, one])).values(),
  ]
  const upstream = latest.map((one) => {
    const settled = readHistoryEnvelope(run, one.activity, one.agent, one.spec)
    if (settled.status === 'error') {
      throw new Error(
        `cannot resume history for '${one.activity}': ${settled.error.message}`,
      )
    }

    return { activity: one.activity, envelope: settled.data }
  })
  const supersedes = (one: (typeof produced)[number]): boolean =>
    activitySuccession(run.cfg.activities, one.agent) === 'supersedes'
  const last = produced.findLast(supersedes)
  const concurrent = units.find(
    (unit) =>
      unit.strategy === 'concurrent' &&
      unit.activities.some((activity) => activity.instance === last?.runName),
  )
  // A concurrent Unit selects its first superseding declaration, not the
  // last Activity Run row it opened. Resume must make the same choice.
  const primary =
    concurrent?.activities
      .flatMap((activity) => {
        const entry = produced.findLast(
          (one) => one.runName === activity.instance && supersedes(one),
        )
        return entry === undefined ? [] : [entry]
      })
      .at(0) ?? last

  return {
    upstream,
    previous: upstream.find((one) => one.activity === primary?.activity)
      ?.envelope,
    previousStep: primary?.activity,
  }
}
