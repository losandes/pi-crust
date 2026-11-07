/**
 * A `TActivity` that settles from a prepared script of outcomes, and a `TRun`
 * backed by a real tracer over a temporary database.
 *
 * `run-workflow.ts` and `run-activities.ts` build their own Activities from
 * `crust.activities.yaml` through `runnableActivities`, which always resolves
 * to `agentActivity` with its live `TAgentPorts` default — there is no
 * injection point for a literal `TActivity` there. `runUnits` and
 * `runActivities`, by contrast, take `activities`/`units` as a parameter, so a
 * fake built here can stand in for the registry entirely: no config, no
 * agent, no `callAgent`.
 *
 * `runReviseLoop` sits in between: it builds its own Activities too, so this
 * helper cannot be injected into it. Its tests instead drive a real `--resume`
 * — `run.resume` naming an instance, with the envelope it would have replayed
 * already on disk — which is the same mechanism a live resumed run uses, and
 * spawns nothing either.
 */

import { join } from 'node:path'
import { createTracer } from '../data/trace-db'
import { activityRunParams } from '../typedefs/activity-run'
import type { TPiCrustConfig } from '../typedefs/config'
import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TActivity, TActivityResult } from '../typedefs/runnable-activity'
import { createRun } from '../use-cases/create-run'

/** What one attempt of a `fakeActivity` does, settled with no agent call. */
export type TAttemptOutcome =
  | Readonly<{ kind: 'accepted'; envelope: TEnvelopeBase }>
  | Readonly<{
      kind: 'violates'
      envelope: TEnvelopeBase
      violations: readonly string[]
    }>
  | Readonly<{ kind: 'throws'; message: string }>

/**
 * The outcome a `fakeActivity` falls back to: an empty script, and a replay
 * of an attempt that threw.
 *
 * A module constant rather than two identical literals written inline. They
 * sat inside expressions nothing in the suite evaluates, and whether a
 * never-evaluated object literal counts as covered turns out to differ by
 * platform — macOS called those fourteen lines covered and Linux did not,
 * which is how one coverage gate passed locally and failed on a runner
 * against identical code and identical tests.
 */
const SETTLES_SUCCESSFULLY: TAttemptOutcome = {
  kind: 'accepted',
  envelope: {
    status: 'success',
    summary: '',
    artifacts: [],
    notes_for_next_agent: '',
  },
}

/**
 * A `TActivity` that settles from `outcomes`, one entry per attempt.
 *
 * The last outcome repeats for any attempt past the end of the list, so a
 * caller does not have to pad a script to the Activity's `attempts` ceiling
 * just to describe "and then it keeps succeeding".
 *
 * A `violates` outcome is reported through a gate carried on the built
 * Activity rather than by failing `execute` itself: `execute` always
 * resolves, exactly as a real Activity's does, and it is `judgeGates` —
 * exercised the same way a real gate is — that turns the declared
 * violations into a retry.
 */
export const fakeActivity = (
  name: string,
  outcomes: readonly TAttemptOutcome[],
): TActivity => {
  let attempt = 0
  let lastViolations: readonly string[] = []
  const at = (index: number): TAttemptOutcome =>
    outcomes[Math.min(index, outcomes.length - 1)] ?? SETTLES_SUCCESSFULLY

  const settle = (
    outcome: Exclude<TAttemptOutcome, Readonly<{ kind: 'throws' }>>,
  ): TActivityResult => {
    if (outcome.kind === 'violates') {
      lastViolations = outcome.violations
      return { previous: outcome.envelope, accepted: true }
    }
    lastViolations = []
    return { previous: outcome.envelope, accepted: true }
  }

  return {
    name,
    instance: name,
    params: activityRunParams({
      name,
      kind: 'agent',
      owner: name,
      description: `Run '${name}', settling from a prepared outcome — no agent is spawned`,
    }),
    requires: [],
    gates: [
      {
        name: 'fake-outcome',
        check: () => ({
          checks: lastViolations.map((violation) => ({
            item: violation,
            ok: false,
            note: violation,
          })),
        }),
      },
    ],
    attempts: outcomes.length,
    commit: false,
    execute: (_ctx, _handle) => {
      const outcome = at(attempt)
      attempt += 1
      if (outcome.kind === 'throws') {
        throw new Error(outcome.message)
      }
      return Promise.resolve(settle(outcome))
    },
    replay: () => {
      const outcome = at(Math.max(attempt - 1, 0))
      return Promise.resolve(
        settle(outcome.kind === 'throws' ? SETTLES_SUCCESSFULLY : outcome),
      )
    },
  }
}

/**
 * A `TRun` whose tracer writes to a temporary sqlite database, so a driver's
 * attempt counts, gate rows and events are read back rather than mocked.
 *
 * `dir` is the caller's own scratch directory (one per test, so a reader can
 * inspect `crust.db` after a failure); `cfg` is passed straight to
 * `createRun`, which is where `repoRoot()`/`vcsRoot()` are resolved from the
 * process's current working directory, exactly as a real run would.
 */
export const runWithTracer = (
  dir: string,
  cfg: TPiCrustConfig,
  resume?: ReadonlySet<string>,
): TRun => {
  const tracer = createTracer(join(dir, 'crust.db'), join(dir, 'events.jsonl'))

  return createRun({
    cfg,
    runId: 'fake0001',
    tracer,
    engineer: 'tester',
    ...(resume === undefined ? {} : { resume }),
  })
}
