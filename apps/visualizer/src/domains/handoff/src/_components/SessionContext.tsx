/**
 * What this run was asked to do, and what it produced — on the run's own page.
 *
 * Shaped after a repository landing page, where the README is simply there:
 * the prompt is the thing a reader needs first and most often, and until now
 * it was a 500-character stub on a card, with the full text only reachable
 * by opening the request activity.
 *
 * No accordions. The activity view folds its context away because a activity has
 * fifteen kinds of it; a run has two, and a fold costs a click to reach the
 * thing you came for.
 */
import { safeParseSettlement, settledOr } from '@typedefs/settlement'
import { useMemo, useState } from 'react'
import type { EventRow } from '@/domains/events'
import { renderMarkdown } from '@/lib/markdown'
import type { Envelope, Session } from '../typedefs/handoff'
import type { TArtifact } from '../usecases/artifacts'
import { runArtifacts } from '../usecases/artifacts'
import { useHandoff } from '../usecases/use-handoff'
import { ArtifactList } from './ArtifactList'
import { DocumentViewer } from './DocumentViewer'
import styles from './SessionContext.module.css'

/**
 * The prompt as it was given, not as the session row kept it.
 *
 * `sessions.request` is truncated to 500 characters for the list; the request
 * activity's own log event holds the whole thing, which for a real request is a
 * markdown document of several pages.
 */
const fullPrompt = (
  events: readonly EventRow[],
  fallback: string | null,
): string => {
  for (const event of events) {
    if (event.type !== 'log' || event.payload_json === null) continue
    const raw = event.payload_json
    // An unreadable log line is skipped; the next one may carry the ask.
    const parsed = settledOr<unknown>(
      safeParseSettlement(() => JSON.parse(raw) as unknown),
      undefined,
    )
    if (parsed === null || typeof parsed !== 'object') continue
    const input = (parsed as { input?: unknown }).input
    if (typeof input === 'string' && input.trim() !== '') return input
  }
  return fallback ?? ''
}

export const SessionContext = ({
  session,
  runId,
  workspace,
  handoffDir,
  envelopes,
  events,
}: Readonly<{
  session: Session
  runId: string
  workspace: string | undefined
  /** This run's handoff directory, resolved absolute by the server. */
  handoffDir: string | undefined
  envelopes: readonly Envelope[]
  events: readonly EventRow[]
}>) => {
  const handoff = useHandoff(runId, workspace, events)
  const [viewing, setViewing] = useState<TArtifact | undefined>(undefined)

  const prompt = useMemo(
    () => fullPrompt(events, session.request),
    [events, session.request],
  )
  const documents = useMemo(
    () =>
      runArtifacts({ runId, handoffDir, envelopes, events, present: handoff }),
    [runId, handoffDir, envelopes, events, handoff],
  )

  return (
    <section className={styles.context}>
      <DocumentViewer
        artifact={viewing}
        runId={runId}
        workspace={workspace}
        onClose={() => setViewing(undefined)}
      />

      <h3 className={styles.head}>what was asked</h3>
      {prompt === '' ? (
        <div className="faint">no prompt recorded</div>
      ) : (
        // Safe: renderMarkdown HTML-escapes all input before producing any
        // tag. This is a document a person wrote, but it arrives through the
        // same door as everything else.
        <div
          className={styles.prompt}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes its input
          dangerouslySetInnerHTML={{ __html: renderMarkdown(prompt) }}
        />
      )}

      <h3 className={styles.head}>
        files
        {documents.length > 0 && (
          <span className={styles.count}>{documents.length}</span>
        )}
      </h3>
      <ArtifactList artifacts={documents} onOpen={setViewing} />
    </section>
  )
}
