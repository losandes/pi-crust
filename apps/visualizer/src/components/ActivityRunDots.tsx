import type { ActivityRun } from '../lib/types'
import styles from './ActivityRunDots.module.css'

const GLYPHS: Readonly<Record<string, string>> = {
  success: '\u25cf',
  running: '\u25d0',
  queued: '\u25cb',
  fail: '\u2717',
}

export const ActivityRunDots = ({ activityRuns }: { activityRuns: readonly ActivityRun[] }) => {
  const ordered = activityRuns.toSorted((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  if (ordered.length === 0) return <span className="faint">{'\u2014'}</span>

  return (
    <span className={styles.dots}>
      {ordered.map((activityRun) => {
        const status = activityRun.status ?? ''
        const tone = styles[status]
        return (
          <span
            key={activityRun.activity_run_id}
            className={tone === undefined ? styles.dot : `${styles.dot} ${tone}`}
            title={`${activityRun.name} \u2014 ${status}`}
          >
            {GLYPHS[status] ?? '\u25cb'}
          </span>
        )
      })}
    </span>
  )
}
