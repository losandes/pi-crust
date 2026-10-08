import { useCallback, useMemo, useState } from 'react'
import { fetchSessions } from '../lib/api'
import { ts } from '../lib/format'
import { paletteColor, workspaceRoles } from '../lib/palette'
import type { SessionSummary } from '../lib/types'
import { usePoll } from '../lib/use-poll'
import { SessionCard } from './SessionCard'
import styles from './SessionsList.module.css'
import { TokenNotice } from './TokenNotice'

const NO_SESSIONS: readonly SessionSummary[] = []

export const SessionsList = () => {
  const poll = usePoll<readonly SessionSummary[]>(fetchSessions, NO_SESSIONS)

  /**
   * Archiving removes the card immediately rather than waiting for the next
   * poll, which could be half a second away. An empty id means the write
   * failed, so the optimistic removal is undone by re-syncing.
   */
  const [archived, setArchived] = useState<readonly string[]>([])
  /*
   * Why the last write was refused, if it was. Held here rather than in the
   * card because the fix is a token field, and a form nested inside the
   * card's <a> would be invalid HTML and unreachable by keyboard.
   */
  const [refused, setRefused] = useState('')
  const onArchived = useCallback(
    (runId: string) => {
      if (runId === '') {
        setArchived([])
        poll.refresh()
        return
      }
      setArchived((previous) => [...previous, runId])
    },
    [poll.refresh],
  )

  /*
   * Which tree the reader is looking at, or all of them.
   *
   * Derived from the runs themselves rather than from /api/workspaces: a tree
   * with nothing in it has nothing to filter to, and a filter offering an
   * empty answer is a filter that wastes a click.
   */
  const [only, setOnly] = useState('')
  const labels = useMemo(
    () => [...new Set(poll.value.map((session) => session.workspace))].filter(Boolean),
    [poll.value],
  )
  const roles = useMemo(() => workspaceRoles(labels), [labels])
  // One tree is the ordinary case, and naming it on every card would be the
  // same word repeated down the page.
  const several = labels.length > 1

  const ordered = useMemo(
    () =>
      poll.value
        .filter((session) => !archived.includes(session.run_id))
        .filter((session) => only === '' || session.workspace === only)
        .toSorted((a, b) => (ts(b.started_at) || 0) - (ts(a.started_at) || 0)),
    [poll.value, archived, only],
  )

  return (
    <div className={styles.sessions}>
      {poll.error !== undefined && (
        <div className="error-bar">api unreachable — retrying {poll.error}</div>
      )}

      {/*
        Above the cards, because it is about the click that just failed and a
        message under a scrolled list is a message nobody reads.
      */}
      <TokenNotice
        problem={refused}
        onSaved={() => setRefused('Token saved — archive that run again.')}
      />

      {ordered.length > 0 ? (
        <>
          <div className={`${styles.head} dim`}>
            {ordered.length} runs
            {several && (
              <span className={styles.filters}>
                <button
                  type="button"
                  className={only === '' ? styles.onFilter : styles.filter}
                  onClick={() => setOnly('')}
                >
                  all trees
                </button>
                {labels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className={only === label ? styles.onFilter : styles.filter}
                    style={{ color: paletteColor(roles.get(label) ?? 'blue') }}
                    onClick={() => setOnly(only === label ? '' : label)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div className={styles.cards}>
            {ordered.map((session) => (
              <SessionCard
                key={`${session.workspace}:${session.run_id}`}
                session={session}
                nowMs={poll.at}
                workspaceRole={
                  several ? (roles.get(session.workspace) ?? 'blue') : undefined
                }
                onArchived={onArchived}
                onRefused={setRefused}
              />
            ))}
          </div>
        </>
      ) : poll.loaded ? (
        <div className="empty-state">no sessions yet — run an lifecycle to see it here</div>
      ) : poll.error === undefined ? (
        <div className="empty-state">loading sessions…</div>
      ) : undefined}
    </div>
  )
}
