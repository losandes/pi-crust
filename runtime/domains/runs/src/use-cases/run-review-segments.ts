/**
 * Settle each review segment before the next Unit starts.
 *
 * The driver retains the whole Unit list so human gates and regressions keep
 * their original successor and destination scope across segment boundaries.
 */

import type {
  TActivityOptions,
  TPiCrustConfig,
  TUnit,
} from '../../../../lib/contracts'
import { acceptedExcluding } from '../../../../lib/contracts'
import type { TAgentPorts } from '../../../activities'
import { attemptLedger } from './attempts'
import type { TReviewGroup, TReviseLoopResult } from './revise-loop'
import { groupApproved, reviewGroups, runReviseLoop } from './revise-loop'
import type { TRunUnitsParams } from './run-activities'
import { runUnits } from './run-activities'

type TReviewBoundary = Readonly<{ through: number; group: TReviewGroup }>

/** A review group may cross Stages, but never end inside a concurrent Unit. */
export const reviewBoundaries = (
  units: readonly TUnit[],
  names: readonly string[],
  cfg: TPiCrustConfig,
): readonly TReviewBoundary[] => {
  const ends = units.map((_, at) =>
    units
      .slice(0, at + 1)
      .reduce((count, unit) => count + unit.activities.length, 0),
  )
  return reviewGroups(names, cfg).map((group) => ({
    through: ends.indexOf(group.at + group.members.length),
    group,
  }))
}

export const runReviewSegments = async (
  params: Readonly<
    Omit<TRunUnitsParams, 'afterUnit'> & {
      names: readonly string[]
      options: Readonly<Partial<TActivityOptions>>
      fallbackReason: string
      agentPorts?: TAgentPorts
    }
  >,
): Promise<TReviseLoopResult> => {
  const { names, options, fallbackReason, agentPorts, ...driver } = params
  const { run } = driver
  const ledger = driver.ledger ?? attemptLedger()
  const boundaries = reviewBoundaries(driver.units, names, run.cfg)
  // Regressions can revisit a boundary. This callback-owned map keeps only its
  // latest settlement without changing the driver's regression history.
  const settlements = new Map<
    number,
    Readonly<{ group: TReviewGroup; result: TReviseLoopResult }>
  >()
  const ctx = await runUnits({
    ...driver,
    ledger,
    afterUnit: async (ctx, at) => {
      const boundary = boundaries.find((one) => one.through === at)
      if (boundary === undefined) {
        return { ctx }
      }
      const result = await runReviseLoop(run, {
        names,
        group: boundary.group,
        options,
        ctx,
        fallbackReason,
        ledger,
        ...(agentPorts === undefined ? {} : { agentPorts }),
      })
      settlements.set(boundary.group.at, { group: boundary.group, result })
      return {
        ctx: result.ctx,
        ...(result.outcome === 'deadlocked' || result.outcome === 'exhausted'
          ? { stopReason: result.reason }
          : {}),
      }
    },
  })
  const settled = [...settlements.values()]
  const stopped = settled.findLast(
    ({ result }) =>
      result.outcome === 'deadlocked' || result.outcome === 'exhausted',
  )?.result
  const approved = settled
    .filter(({ result }) => result.outcome === 'approved')
    .flatMap(({ group }) => group.members)
  return {
    ctx,
    outcome:
      stopped?.outcome ?? (approved.length > 0 ? 'approved' : 'not-applicable'),
    accepted:
      stopped === undefined &&
      acceptedExcluding(ctx.outcomes, approved) &&
      settled.every(
        ({ group, result }) =>
          result.outcome === 'approved' ||
          groupApproved(result.ctx.outcomes, group.members),
      ),
    reason: stopped?.reason ?? fallbackReason,
  }
}
