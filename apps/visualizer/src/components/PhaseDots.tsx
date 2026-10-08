import type { Phase } from '../lib/types'
import styles from './PhaseDots.module.css'

const GLYPHS: Readonly<Record<string, string>> = {
  success: '\u25cf',
  running: '\u25d0',
  queued: '\u25cb',
  fail: '\u2717',
}

export const PhaseDots = ({ phases }: { phases: readonly Phase[] }) => {
  const ordered = phases.toSorted((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  if (ordered.length === 0) return <span className="faint">{'\u2014'}</span>

  return (
    <span className={styles.dots}>
      {ordered.map((phase) => {
        const status = phase.status ?? ''
        const tone = styles[status]
        return (
          <span
            key={phase.phase_id}
            className={tone === undefined ? styles.dot : `${styles.dot} ${tone}`}
            title={`${phase.name} \u2014 ${status}`}
          >
            {GLYPHS[status] ?? '\u25cb'}
          </span>
        )
      })}
    </span>
  )
}
