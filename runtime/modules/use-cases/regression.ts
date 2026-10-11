/**
 * Going back, bounded — and deciding when going back has stopped helping.
 *
 * The lifecycle's Regression Rule: when new evidence invalidates an earlier
 * assumption or decision, return to the earliest affected stage rather than
 * compensating for it downstream. A builder that finds the design cannot work
 * has found something; building a workaround buries it.
 *
 * A POC is the clearest case. Its whole job is to disprove things cheaply, so
 * a hypothesis that fails is a SUCCESS for the stage and usually a regression
 * for the chain: the concept or the logical architecture it was testing is not
 * worth implementing, and `conceptualize` should hear that rather than `build`
 * discovering it a thousand lines later.
 *
 * The bound is the whole design problem. Unbounded, two stages can disagree
 * forever at a build-sized price per lap. So: a stage may be returned to ONCE.
 * A second regression to the same stage is not a loop worth paying for — it is
 * a disagreement no agent is going to settle, and it goes to the developer.
 *
 * Pure. The driver applies these decisions; this module makes them.
 */

import type { TRegression } from '../typedefs/envelope'

/** A regression that happened, in the order they happened. */
export type TRegressionRecord = Readonly<{
  /** the stage that asked */
  from: string
  /** the stage it asked to return to */
  to: string
  because: string
}>

export type TRegressionVerdict =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'regress'; to: string; index: number }>
  | Readonly<{ kind: 'refused'; reason: string }>
  | Readonly<{ kind: 'exhausted'; reason: string }>

/** How often a stage has already been returned to. */
export const timesReturnedTo = (
  history: readonly TRegressionRecord[],
  stage: string,
): number => history.filter((record) => record.to === stage).length

/**
 * What the driver should do about a stage's request to go back.
 *
 * Four answers, and three of them are refusals — which is deliberate. The
 * expensive mistake is not refusing a good regression; it is honouring a bad
 * one, because each lap costs every stage in between.
 */
export const regressionVerdict = (params: {
  readonly request: TRegression | undefined
  /** the chain, in order, as the driver will re-run it */
  readonly names: readonly string[]
  /** where the asking stage sits in that chain */
  readonly askedAt: number
  readonly history: readonly TRegressionRecord[]
  readonly maxReturnsPerStage: number
}): TRegressionVerdict => {
  const { request, names, askedAt, history, maxReturnsPerStage } = params
  if (request === undefined) {
    return { kind: 'none' }
  }
  const index = names.indexOf(request.activity)
  if (index === -1) {
    return {
      kind: 'refused',
      reason:
        `asked to return to '${request.activity}', which this chain does not ` +
        `run (it runs ${names.join(' -> ')}). Compose a chain that includes ` +
        'it, or carry the finding forward as an unresolved question.',
    }
  }
  if (index >= askedAt) {
    return {
      kind: 'refused',
      reason:
        `asked to return to '${request.activity}', which is not EARLIER in the ` +
        'chain. Regression goes backwards; a later stage is just the next ' +
        'step.',
    }
  }
  if (timesReturnedTo(history, request.activity) >= maxReturnsPerStage) {
    return {
      kind: 'exhausted',
      reason:
        `'${request.activity}' has already been returned to once, and is being ` +
        `asked for again: ${request.because}. Two laps over the same stage ` +
        'is a disagreement no agent is going to settle on its own.',
    }
  }
  return { kind: 'regress', to: request.activity, index }
}

/** One line for the trace and the console, in a reader's words. */
export const regressionNote = (record: TRegressionRecord): string =>
  `${record.from} sent the run back to ${record.to}: ${record.because}`
