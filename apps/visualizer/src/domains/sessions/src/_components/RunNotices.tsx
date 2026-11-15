/**
 * What happened to this run as a whole: a note typed picking it back up, and
 * either half of a branch. Beside `TreeWarnings` in the no-activity-selected
 * view, because both answer "what happened here" before any one activity's
 * conversation is open \u2014 and because this was previously visible only in
 * the raw events tab, which is not where a run-scoped fact belongs.
 */
import { GitBranch, StickyNote } from 'lucide-react'
import { hrefFor } from '@/lib/router'
import type { TRunNotice } from '../usecases/notices'

export const RunNotices = ({
  notices,
  workspace,
}: Readonly<{
  notices: readonly TRunNotice[]
  workspace?: string
}>) => {
  if (notices.length === 0) return undefined

  return (
    <div className="mx-7 mt-5 mb-3 flex flex-col gap-2 rounded-xl border-[length:var(--border-width)] border-l-3 border-border-soft bg-panel-2 px-4 py-3.5">
      {notices.map((notice, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: notices carry no id of their own, and never reorder once rendered
          key={index}
          className="flex min-w-0 items-start gap-2 text-sm leading-normal wrap-anywhere"
        >
          {notice.kind === 'note' ? (
            <>
              <StickyNote
                className="mt-0.5 flex-none text-dim"
                size={16}
                strokeWidth={2}
              />
              <span>
                <strong>{notice.from}</strong> left a note picking this run back
                up: <span className="italic">{notice.text}</span>
              </span>
            </>
          ) : notice.kind === 'branched_from' ? (
            <>
              <GitBranch
                className="mt-0.5 flex-none text-dim"
                size={16}
                strokeWidth={2}
              />
              <span>
                branched from{' '}
                <a href={hrefFor(notice.runId, undefined, workspace)}>
                  {notice.runId}
                </a>{' '}
                at <code>{notice.activity}</code>
              </span>
            </>
          ) : (
            <>
              <GitBranch
                className="mt-0.5 flex-none text-dim"
                size={16}
                strokeWidth={2}
              />
              <span>
                branched to{' '}
                <a href={hrefFor(notice.runId, undefined, workspace)}>
                  {notice.runId}
                </a>{' '}
                from <code>{notice.activity}</code>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
