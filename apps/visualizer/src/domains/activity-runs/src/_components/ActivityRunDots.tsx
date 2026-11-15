import type { ActivityRun } from '../typedefs/activity-run'
import { byStart } from '../usecases/order'

const TONE: Readonly<Partial<Record<string, string>>> = {
  success: 'text-ok',
  fail: 'text-fail',
  running: 'animate-[crust-pulse_1.2s_ease-in-out_infinite] text-busy',
  queued: 'text-faint',
}

const GLYPHS: Readonly<Record<string, string>> = {
  success: '\u25cf',
  running: '\u25d0',
  queued: '\u25cb',
  fail: '\u2717',
}

export const ActivityRunDots = ({
  activityRuns,
}: Readonly<{
  activityRuns: readonly ActivityRun[]
}>) => {
  // By start, not by `seq`: two dots for a concurrent Stage must not claim
  // an order the run did not have.
  const ordered = activityRuns.toSorted(byStart)

  if (ordered.length === 0)
    return <span className="text-faint">{'\u2014'}</span>

  return (
    <span className="inline-flex flex-wrap gap-1 text-base tracking-normal">
      {ordered.map((activityRun) => {
        const status = activityRun.status ?? ''
        return (
          <span
            key={activityRun.activity_run_id}
            className={TONE[status]}
            title={`${activityRun.name} \u2014 ${status}`}
          >
            {GLYPHS[status] ?? '\u25cb'}
          </span>
        )
      })}
    </span>
  )
}
