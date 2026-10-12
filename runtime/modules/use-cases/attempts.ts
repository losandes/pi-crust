/**
 * One ceiling: how many times one Activity instance may run in one run.
 *
 * It replaces three separate caps — a gate-failure retry count, two revise
 * rounds, one regression per stage — which each counted a different kind of
 * thing and none of which knew about the others. The failure modes are
 * correlated, not independent: one bad input or one bad prompt expresses
 * itself as a gate failure, then a revision, then a regression, and three
 * budgets let that burn three times before a person is asked.
 *
 * An attempt IS an Activity Run. Every autonomous re-execution gets its own
 * row, which is why this can be counted at all: the thing being budgeted and
 * the thing being recorded are finally the same thing.
 *
 * The budget is per INSTANCE, not per Activity. A Lifecycle naming `test`
 * twice gives `test` and `test_2` two each, because editing a Lifecycle must
 * not change the behaviour of an instance it did not touch.
 *
 * Human-directed re-execution is not an attempt. A steer and a resume past
 * an answered gate are a person deciding; a replay executes nothing. Only
 * the run's own decisions spend from this.
 */

export type TAttemptLedger = Readonly<{
  /** Record one autonomous execution. Returns the attempt number it is. */
  spend: (instance: string, cause: string) => number
  /** How many attempts this instance has already spent. */
  spent: (instance: string) => number
  /** Every cause that spent this instance's budget, in order. */
  causes: (instance: string) => readonly string[]
  /** How many attempts are left, given the Activity's declared ceiling. */
  remaining: (instance: string, attempts: number) => number
  /** An itemised account of where the budget went — one number explains nothing. */
  report: (instance: string, attempts: number) => string
}>

/** The first attempt is an attempt. It is recorded with this reason. */
export const FIRST_ATTEMPT = 'first attempt'

export const attemptLedger = (
  /**
   * Attempts already on the record, by instance name.
   *
   * A resumed run reads its own trace, so a budget cannot be refilled by
   * starting the same run again. Steered Activity Runs are left out by the
   * caller, because a person asking for the work again is not the run
   * deciding to.
   */
  seed: readonly string[] = [],
): TAttemptLedger => {
  const ledger = new Map<string, readonly string[]>()
  for (const instance of seed) {
    ledger.set(instance, [...(ledger.get(instance) ?? []), 'an earlier run of this session'])
  }
  const causes = (instance: string): readonly string[] =>
    ledger.get(instance) ?? []

  return {
    causes,
    spent: (instance) => causes(instance).length,
    spend: (instance, cause) => {
      const next = [...causes(instance), cause]
      ledger.set(instance, next)

      return next.length
    },
    remaining: (instance, attempts) =>
      Math.max(0, attempts - causes(instance).length),
    report: (instance, attempts) =>
      `'${instance}' has spent all ${attempts} attempt(s) this run:\n` +
      causes(instance)
        .map((cause, at) => `  ${at + 1}. ${cause}`)
        .join('\n'),
  }
}

/** Why an Activity is running again, in the words the report will use. */
export const gateCause = (violations: readonly string[]): string =>
  `gate failure: ${violations.join('; ')}`

export const regressionCause = (from: string, because: string): string =>
  `sent back by '${from}': ${because}`

export const reviseCause = (round: number): string =>
  `revise round ${round} after a review that did not approve`
