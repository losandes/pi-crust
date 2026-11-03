/**
 * What the run could not account for, where the run is being read.
 *
 * It is a report, not a question: nothing is waiting on the reader, nothing
 * was undone, and there is no button here. That is the whole claim the panel
 * makes, so it is styled as a note rather than as an alert — an alert reads
 * as "something is broken", and the usual cause is a developer saving a file
 * in their own repository while the run worked.
 */
import { TriangleAlert } from 'lucide-react'
import type { TTreeWarning } from '../lib/warnings'
import { warningExplanation, warningTitle } from '../lib/warnings'
import styles from './TreeWarnings.module.css'

const KINDS: readonly TTreeWarning['kind'][] = [
  'unexpected',
  'overstep',
  'refusal',
  'uncommitted',
]

export const TreeWarnings = ({
  warnings,
  standalone = false,
}: Readonly<{
  warnings: readonly TTreeWarning[]
  /**
   * On the page itself rather than inside a column that owns its gutter.
   *
   * Same arrangement as the decision request, and for the same reason: the
   * Activity screen renders this inside a padded column, so a horizontal
   * margin baked into the panel would double there, and the session page has
   * no padding of its own, so without one the panel runs to the edge of the
   * window while every card beside it does not.
   */
  standalone?: boolean
}>) => {
  if (warnings.length === 0) return undefined

  return (
    <div
      className={
        standalone ? `${styles.panel} ${styles.standalone}` : styles.panel
      }
    >
      {KINDS.map((kind) => {
        const group = warnings.filter((warning) => warning.kind === kind)
        if (group.length === 0) return undefined

        return (
          <section key={kind} className={styles.group}>
            <h5 className={styles.head}>
              <TriangleAlert
                className={styles.icon}
                size={16}
                strokeWidth={2}
              />
              {warningTitle(kind)}
            </h5>
            {group.map((warning) => (
              <div
                key={`${warning.stage}-${warning.activityRunIds.join('+')}-${warning.paths.join('+')}`}
                className={styles.entry}
              >
                <span className={styles.who}>
                  {warning.activities.join(', ')}
                  <span className="dim"> ({warning.stage})</span>
                </span>
                <ul className={styles.paths}>
                  {warning.paths.map((path) => (
                    <li key={path} className={styles.path}>
                      {path}
                    </li>
                  ))}
                </ul>
                {warning.note !== '' && (
                  <p className={`${styles.note} dim`}>{warning.note}</p>
                )}
              </div>
            ))}
            <p className={styles.explain}>{warningExplanation(kind)}</p>
          </section>
        )
      })}
    </div>
  )
}
