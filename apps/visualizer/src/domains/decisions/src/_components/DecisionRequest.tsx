/**
 * The question a waiting run is asking, rendered where it is being asked.
 *
 * The gate writes its request to the session's handoff directory and the
 * terminal prints the path to it. In the browser that path is useless: it
 * named a file on a machine the reader may not be sitting at, so the controls
 * offered approve, reject and answer for a question that was nowhere on the
 * page. Approving something you cannot read is not a decision.
 *
 * It reads as the last message of the run rather than as a banner, because
 * that is what it is: the activity emits its facts and its questions, and this is
 * the sentence that follows them.
 */
import { useEffect, useState } from 'react'
import { Prose } from '@/lib/_components'
import { cx } from '@/lib/cx'
import { renderMarkdown } from '@/lib/markdown'
import { fetchDecisionRequest } from '../io/fetch-decision-request'

const VARIANT = {
  inline: 'mb-3',
  standalone: 'mx-4 mt-5 mb-3 @sm:mx-7',
} as const

export const DecisionRequest = ({
  runId,
  status,
  workspace,
  standalone = false,
}: Readonly<{
  runId: string
  status: string
  /** The tree holding this run — the question is a file beside it. */
  workspace?: string
  /** true on the page with no activity selected, where it owns its own gutter */
  standalone?: boolean
}>) => {
  const [markdown, setMarkdown] = useState('')

  /*
   * Fetched on the status edge, not polled. The request is written once when
   * the run stops and does not change while it waits, so polling it would be
   * a request a second forever to re-read a file that cannot have moved.
   */
  useEffect(() => {
    if (status !== 'waiting') {
      setMarkdown('')
      return
    }
    let live = true
    fetchDecisionRequest(runId, workspace)
      .then((request) => {
        if (live && request.present) setMarkdown(request.markdown)
      })
      .catch(() => {
        // A missing question must not break the page that answers it: the
        // controls below still work, which is the state we were in before.
        if (live) setMarkdown('')
      })
    return () => {
      live = false
    }
  }, [runId, status, workspace])

  if (markdown === '') return undefined

  return (
    <section
      className={cx(
        'min-w-0 rounded-md border-(length:--border-width) border-waiting/[calc(var(--edge-alpha)*100%)] border-l-3 border-l-waiting bg-transparent px-4 py-3.5 shadow-[0_0_--spacing(4.5)_rgb(var(--waiting-rgb)/0.14)]',
        VARIANT[standalone ? 'standalone' : 'inline'],
      )}
      aria-label="what this run is asking"
    >
      <h2 className="mt-0 mb-2.5 flex items-center gap-2 text-sm font-semibold tracking-wide text-waiting lowercase">
        <span
          className="size-2 shrink-0 rounded-full bg-waiting"
          aria-hidden="true"
        />
        it is asking you
      </h2>
      <Prose html={renderMarkdown(markdown)} variant="compact" />
    </section>
  )
}
