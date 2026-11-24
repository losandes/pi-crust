import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TokenNotice } from '@/lib/_components'
import { ts } from '@/lib/format'
import { workspaceRoles } from '@/lib/palette'
import { usePoll } from '@/lib/polling'
import { fetchSessions } from '../io/fetch-sessions'
import { readFilters, saveFilters } from '../state/filters-store'
import {
  FILTER_KEYS,
  FILTER_LABELS,
  type TFilterKey,
  type TFilters,
} from '../typedefs/filters'
import type { SessionSummary } from '../typedefs/session'
import {
  isOptimisticallyHidden,
  matchesFilters,
  needsArchived,
  optionsFor,
} from '../usecases/filters'
import { lastPathSegment } from '../usecases/resolve-repository-label'
import { FilterDropdown } from './FilterDropdown'
import { SessionCard } from './SessionCard'

const NO_SESSIONS: readonly SessionSummary[] = []

export const SessionsList = () => {
  /*
   * Which values each of the five categories is narrowed to. Read once from
   * sessionStorage and written back on every change, so a same-tab refresh
   * restores the reader's filters without asking again.
   */
  const [filters, setFilters] = useState<TFilters>(() =>
    readFilters(window.sessionStorage),
  )
  useEffect(() => {
    saveFilters(window.sessionStorage, filters)
  }, [filters])

  const poll = usePoll<readonly SessionSummary[]>(
    () => fetchSessions(undefined, needsArchived(filters)),
    NO_SESSIONS,
  )

  /**
   * Archiving removes the card immediately rather than waiting for the next
   * poll, which could be half a second away. An empty id means the write
   * failed, so the optimistic removal is undone by re-syncing. Once the
   * server confirms the write, the `archived` category governs whether the
   * row is shown, so filtering to `archived` sees the run just archived
   * instead of one invisible until remount.
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
   * Tree labels and roles, derived from the loaded sessions rather than from
   * /api/workspaces: a tree with nothing in it has nothing to filter to, and
   * a tree's colour in the dropdown has to be the colour on its cards.
   */
  const labels = useMemo(
    () => optionsFor(poll.value, 'workspace'),
    [poll.value],
  )
  const roles = useMemo(() => workspaceRoles(labels), [labels])

  const ordered = useMemo(
    () =>
      poll.value
        .filter((session) => !isOptimisticallyHidden(session, archived))
        .filter((session) => matchesFilters(session, filters))
        .toSorted((a, b) => (ts(b.started_at) || 0) - (ts(a.started_at) || 0)),
    [poll.value, archived, filters],
  )

  const [openKey, setOpenKey] = useState<TFilterKey | ''>('')
  const rowRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (openKey === '') return

    // The dropdown button that opened the panel, found by its aria state
    // rather than threaded through FilterDropdown's props — Escape (1.2.9)
    // needs to return focus to it, and nothing else in this component does.
    triggerRef.current =
      rowRef.current?.querySelector<HTMLElement>(
        'button[aria-expanded="true"]',
      ) ?? null

    const onPointerDown = (event: PointerEvent) => {
      if (rowRef.current && !rowRef.current.contains(event.target as Node)) {
        setOpenKey('')
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenKey('')
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openKey])

  const openDropdown = (key: TFilterKey, open: boolean) => {
    setOpenKey(open ? key : '')
  }

  const toggleOption = (key: TFilterKey, value: string) => {
    setFilters((previous) => {
      const selection = previous[key]
      const next = selection.includes(value)
        ? selection.filter((existing) => existing !== value)
        : [...selection, value]
      return { ...previous, [key]: next }
    })
  }

  const selectAll = (key: TFilterKey) => {
    setFilters((previous) => ({ ...previous, [key]: [] }))
  }

  return (
    <div className="@container/dashboard relative flex min-w-0 flex-col">
      {poll.error !== undefined && (
        <div className="mx-4 my-3 rounded-lg border-[length:var(--border-width)] border-fail/45 bg-fail/10 px-3.5 py-2.5 text-base text-red sm:mx-6">
          api unreachable — retrying {poll.error}
        </div>
      )}

      {/*
        Above the cards, because it is about the click that just failed and a
        message under a scrolled list is a message nobody reads.
      */}
      <TokenNotice
        problem={refused}
        onSaved={() => setRefused('Token saved — archive that run again.')}
      />

      {poll.value.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-4 px-4 pt-4 text-base text-dim sm:px-6">
            {ordered.length} runs
            <span
              className="flex min-w-0 flex-wrap items-center gap-2"
              ref={rowRef}
            >
              {FILTER_KEYS.map((key) => {
                const options = optionsFor(poll.value, key)
                // The `archived` pill always renders; the rest need at least
                // two options to be worth a click, or an active selection the
                // reader must still be able to clear.
                const shouldRender =
                  key === 'archived' ||
                  options.length > 1 ||
                  filters[key].length > 0
                if (!shouldRender) return null

                return (
                  <FilterDropdown
                    key={key}
                    label={FILTER_LABELS[key]}
                    labelOf={key === 'repository' ? lastPathSegment : undefined}
                    options={options}
                    selected={filters[key]}
                    open={openKey === key}
                    colorOf={
                      key === 'workspace'
                        ? (option: string) => roles.get(option)
                        : undefined
                    }
                    onOpen={(open) => openDropdown(key, open)}
                    onToggle={(value) => toggleOption(key, value)}
                    onSelectAll={() => selectAll(key)}
                  />
                )
              })}
            </span>
          </div>
          {ordered.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 px-4 pt-4 pb-6 sm:px-6 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
              {ordered.map((session) => (
                <SessionCard
                  key={`${session.workspace}:${session.run_id}`}
                  session={session}
                  nowMs={poll.at}
                  workspaceRole={roles.get(session.workspace) ?? 'blue'}
                  onArchived={onArchived}
                  onRefused={setRefused}
                />
              ))}
            </div>
          ) : (
            <div className="px-6 py-14 text-center text-base text-dim">
              no runs match these filters
            </div>
          )}
        </>
      ) : poll.loaded ? (
        <div className="px-6 py-14 text-center text-base text-dim">
          no sessions yet — run an lifecycle to see it here
        </div>
      ) : poll.error === undefined ? (
        <div className="px-6 py-14 text-center text-base text-dim">
          loading sessions…
        </div>
      ) : undefined}
    </div>
  )
}
