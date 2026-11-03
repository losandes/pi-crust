/**
 * What an Activity Run was OBSERVED to change, written once and read by three.
 *
 * The observation already existed — `enforcePermissions` computed it and the
 * trace recorded it as `paths_touched` — and then nothing used it. A commit
 * ran `git add -A` instead, which is how a developer's unrelated work in
 * progress ended up inside an Activity's commit.
 *
 * So the record carries everything the three readers need:
 *
 *   * what the Activity Run changed      -> the scope of its commit
 *   * what was already dirty when it     -> excluded from the comparison, because
 *     started                               it was already changing before this
 *                                           Activity existed
 *   * what the Activity itself claimed   -> the other half of the comparison
 *
 * Read back out of the trace rather than threaded through the fold, which is
 * how `self_answered` and a activity's artifacts are read: the events are
 * written as they happen, so a run that died half way still has its record,
 * and no surface can drift from what was traced.
 */

import type { TEnvelopeBase } from '../typedefs/envelope'
import type { TRun } from '../typedefs/run'
import type { TTreeWarning } from '../typedefs/warning'
import { repoRelative } from './path-policy'

/** The `log` event name the observation is filed under, and read back by. */
export const PATHS_TOUCHED = 'paths_touched'

export type TObservedPaths = Readonly<{
  /** the Activity Run's name — `build`, `build_2` — which a budget is kept per */
  activity: string
  activityRunId: string
  agent: string
  /** observed to have changed, with any concurrent sibling's paths removed */
  touched: readonly string[]
  /** already dirty when this Activity Run started */
  dirtyBefore: readonly string[]
  /** what the envelope said it changed — a claim, never the evidence */
  claimed: readonly string[]
}>

export const observedPayload = (
  observed: TObservedPaths,
): Readonly<Record<string, unknown>> => ({
  activity: observed.activity,
  activity_run_id: observed.activityRunId,
  agent: observed.agent,
  paths: observed.touched,
  dirty_before: observed.dirtyBefore,
  claimed: observed.claimed,
})

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * What an Activity said it wrote — BOTH ways an envelope can say it.
 *
 * `changed_files` belongs to the writing contract and nothing else. Read
 * alone, it makes every Activity with a different contract claim nothing: a
 * Planner that wrote the plan it was asked for, declared it in `artifacts`,
 * and left no other mark was reported as an unexplained change, which is a
 * warning about the system working.
 *
 * `artifacts` is on every envelope, so the union is the honest reading of
 * "what did this Activity say it produced". Both are still claims and neither
 * decides what is committed — that stays with what was observed.
 *
 * Spellings are normalised to repo-relative, because the comparison is
 * against git's answer: an agent may declare the absolute path it was handed
 * for its handoff document, and `/…/plan.md` and `plan.md` must not read as
 * two different files.
 */
export const claimedPaths = (
  repoRoot: string,
  envelope: TEnvelopeBase | undefined,
): readonly string[] => {
  if (envelope === undefined) {
    return []
  }
  const declared = [
    ...strings((envelope as Readonly<Record<string, unknown>>).changed_files),
    ...envelope.artifacts,
  ]

  return [...new Set(declared.map((path) => repoRelative(repoRoot, path)))]
}

/**
 * One traced payload as an observation.
 *
 * Tolerant of a payload written before the other two sets were recorded: an
 * older trace carries `paths` alone, which reads as "nothing was dirty and
 * nothing was claimed". That is the honest reading of a record that does not
 * say, and it is only ever used to report, never to act.
 */
export const observationFrom = (
  payload: Readonly<Record<string, unknown>>,
): TObservedPaths => ({
  activity: text(payload.activity),
  activityRunId: text(payload.activity_run_id),
  agent: text(payload.agent),
  touched: strings(payload.paths),
  dirtyBefore: strings(payload.dirty_before),
  claimed: strings(payload.claimed),
})

export const observationsIn = (run: TRun): readonly TObservedPaths[] =>
  run.tracer
    .eventsNamed(run.runId, PATHS_TOUCHED)
    .map((payload) => observationFrom(payload))

/**
 * Everything one Activity was observed to change, across every attempt.
 *
 * Every attempt, because a gate failure re-runs the Activity as a NEW Activity
 * Run: the file its first attempt wrote and its second did not touch again is
 * still that Activity's work, and leaving it out would leave it uncommitted
 * for the next Activity to sweep up under the wrong message.
 */
export const touchedBy = (run: TRun, activity: string): readonly string[] =>
  [
    ...new Set(
      observationsIn(run)
        .filter((observed) => observed.activity === activity)
        .flatMap((observed) => observed.touched),
    ),
  ].toSorted()

/**
 * The one interesting set: changed, during this Activity Run, not already
 * changing, and not reported.
 *
 * `touched` alone warns about a developer's unrelated edits forever.
 * `touched - claimed` alone warns about everything that was already dirty
 * before the Activity started, which is the same noise. Subtracting both
 * leaves what is worth saying out loud — and still does not attribute it:
 * an agent writing without reporting and a developer saving a file mid-
 * Activity both land here, and nothing in the tree tells them apart.
 */
export const unexpectedIn = (observed: TObservedPaths): readonly string[] =>
  observed.touched.filter(
    (path) =>
      !(observed.claimed.includes(path) || observed.dirtyBefore.includes(path)),
  )

/**
 * The latest observation per Activity — a gate failure re-runs an Activity,
 * and the attempt that was superseded is not the one to warn about twice.
 */
export const latestPerActivity = (
  observations: readonly TObservedPaths[],
): readonly TObservedPaths[] =>
  observations.filter(
    (observed, index) =>
      !observations.some(
        (other, later) => later > index && other.activity === observed.activity,
      ),
  )

/**
 * What one Unit is worth saying out loud, as warnings.
 *
 * A concurrent Stage raises ONE warning naming the Activities that were
 * running, rather than one per Activity saying the same thing about the same
 * path: the path is exactly as unattributable between two siblings as it is
 * between an agent and a developer, and three copies of an answer nobody can
 * act on is noise rather than evidence.
 */
export const unexpectedWarnings = (
  params: Readonly<{
    stage: string
    concurrent: boolean
    observations: readonly TObservedPaths[]
  }>,
): readonly TTreeWarning[] => {
  const seen = latestPerActivity(params.observations).map((observed) => ({
    observed,
    unexpected: unexpectedIn(observed),
  }))
  const raised = seen.filter((one) => one.unexpected.length > 0)
  if (raised.length === 0) {
    return []
  }
  if (!params.concurrent) {
    return raised.map((one) => ({
      kind: 'unexpected' as const,
      activities: [one.observed.activity],
      activityRunIds: [one.observed.activityRunId],
      stage: params.stage,
      paths: one.unexpected,
      note: '',
    }))
  }

  return [
    {
      kind: 'unexpected',
      // Every Activity in the Stage, not only the ones that reported a path:
      // the question the warning answers is "who was running", and a sibling
      // that reported nothing was running just as much as one that did.
      activities: seen.map((one) => one.observed.activity),
      activityRunIds: seen.map((one) => one.observed.activityRunId),
      stage: params.stage,
      paths: [...new Set(raised.flatMap((one) => one.unexpected))].toSorted(),
      note:
        'these Activities ran at the same time, so which of them changed ' +
        'a path is not a question the tree can answer',
    },
  ]
}
