/**
 * What happened to this run as a whole: a note typed picking it back up, and
 * either half of a branch. Beside `TreeWarnings` in the no-activity-selected
 * view, because both answer "what happened here" before any one activity's
 * conversation is open \u2014 and because this was previously visible only in
 * the raw events tab, which is not where a run-scoped fact belongs.
 */
import { GitBranch, StickyNote } from 'lucide-react'
import { hrefFor } from '../lib/router'
import type { TRunNotice } from '../lib/notices'
import styles from './RunNotices.module.css'

export const RunNotices = ({
  notices,
  workspace,
}: Readonly<{
  notices: readonly TRunNotice[]
  workspace?: string
}>) => {
  if (notices.length === 0) return undefined

  return (
    <div className={styles.panel}>
      {notices.map((notice, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: notices carry no id of their own, and never reorder once rendered
        <div key={index} className={styles.entry}>
          {notice.kind === 'note' ? (
            <>
              <StickyNote className={styles.icon} size={16} strokeWidth={2} />
              <span>
                <strong>{notice.from}</strong> left a note picking this run back
                up: <span className={styles.text}>{notice.text}</span>
              </span>
            </>
          ) : notice.kind === 'branched_from' ? (
            <>
              <GitBranch className={styles.icon} size={16} strokeWidth={2} />
              <span>
                branched from{' '}
                <a href={hrefFor(notice.runId, undefined, workspace)}>{notice.runId}</a>{' '}
                at <code>{notice.activity}</code>
              </span>
            </>
          ) : (
            <>
              <GitBranch className={styles.icon} size={16} strokeWidth={2} />
              <span>
                branched to{' '}
                <a href={hrefFor(notice.runId, undefined, workspace)}>{notice.runId}</a>{' '}
                from <code>{notice.activity}</code>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
