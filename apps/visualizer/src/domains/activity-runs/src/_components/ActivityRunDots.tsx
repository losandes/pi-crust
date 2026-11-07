import type { ActivityRun } from '../typedefs/activity-run'
import { byStart } from '../usecases/order'
import styles from './ActivityRunDots.module.css'

const GLYPHS: Readonly<Record<string, string>> = {
  success: '\u25cf',
  running: '\u25d0',
  queued: '\u25cb',
  fail: '\u2717',
}

export const ActivityRunDots = ({
  activityRuns,
}: {
  activityRuns: readonly ActivityRun[]
}) => {
  // By start, not by `seq`: two dots for a concurrent Stage must not claim
  // an order the run did not have.
  const ordered = activityRuns.toSorted(byStart)

  if (ordered.length === 0) return <span className="faint">{'\u2014'}</span>

  return (
    <span className={styles.dots}>
      {ordered.map((activityRun) => {
        const status = activityRun.status ?? ''
        const tone = styles[status]
        return (
          <span
            key={activityRun.activity_run_id}
            className={
              tone === undefined ? styles.dot : `${styles.dot} ${tone}`
            }
            title={`${activityRun.name} \u2014 ${status}`}
          >
            {GLYPHS[status] ?? '\u25cb'}
          </span>
        )
      })}
    </span>
  )
}
