import type {
  TActivityRun,
  TActivityRunStatus,
  TRun,
} from '../../../../lib/contracts'
import { nowIso } from '../../../../lib/system'

/** A row in one of these statuses is an attempt that ran, or is running. */
export const ATTEMPT_STATUSES: readonly TActivityRunStatus[] = [
  'running',
  'success',
  'fail',
  'waiting',
]

/** A row in one of these statuses stops deciding once a later attempt exists. */
export const REPLACEABLE_STATUSES: readonly TActivityRunStatus[] = [
  'fail',
  'running',
]

export const ATTEMPT_SUPERSEDED_EVENT = 'attempt_superseded'

export const NEVER_SETTLED =
  'a later attempt of this Activity started before this one settled — ' +
  'it was interrupted, or it died without settling'

export type TReplacedAttempt = Readonly<{
  replaced: TActivityRun
  by: TActivityRun
}>

export const replacedAttempts = (
  rows: readonly TActivityRun[],
): readonly TReplacedAttempt[] =>
  rows
    .filter((row) => REPLACEABLE_STATUSES.includes(row.status))
    .flatMap((replaced) => {
      const by = rows
        .filter(
          (row) =>
            row.params.name === replaced.params.name &&
            row.seq > replaced.seq &&
            ATTEMPT_STATUSES.includes(row.status),
        )
        .toSorted((a, b) => b.seq - a.seq)
        .at(0)
      return by === undefined ? [] : [{ replaced, by }]
    })
    .toSorted((a, b) => a.replaced.seq - b.replaced.seq)

export const supersedeReplacedAttempts = ({
  runId,
  tracer,
}: Pick<TRun, 'runId' | 'tracer'>): readonly TReplacedAttempt[] => {
  const replacements = replacedAttempts(tracer.activityRunsFor(runId))
  replacements.forEach(({ replaced, by }) => {
    tracer.activityRunUpsert({
      ...replaced,
      status: 'superseded',
      error:
        replaced.status === 'running'
          ? (replaced.error ?? NEVER_SETTLED)
          : replaced.error,
      ended_at:
        replaced.status === 'running'
          ? (replaced.ended_at ?? nowIso())
          : replaced.ended_at,
    })
    tracer.event({
      run_id: runId,
      activity_run_id: replaced.activity_run_id,
      type: 'log',
      name: ATTEMPT_SUPERSEDED_EVENT,
      payload: {
        activity: replaced.params.name,
        was: replaced.status,
        replaced_by: by.activity_run_id,
      },
    })
  })
  return replacements
}
