import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityRunDots } from '@/domains/activity-runs'
import type { EventRow } from '@/domains/events'
import { agentColor, dotColor, eventLabel, fetchEvents } from '@/domains/events'
import { StatChip, StatusChip } from '@/lib/_components'
import { cx } from '@/lib/cx'
import { axisTicks, fmtDate, fmtOffset, ts } from '@/lib/format'
import { paletteColor } from '@/lib/palette'
import { hrefFor } from '@/lib/router'
import { archiveSession } from '../io/send-archive-session'
import type { SessionSummary } from '../typedefs/session'

/**
 * The timeline shows at most MAX_VISIBLE_ROWS slots. An overflowing roster
 * spends one slot on "+N more", retaining at least three visible agents so a
 * five-agent chain still reads as a chain rather than as a pair and a count.
 */
const MAX_VISIBLE_ROWS = 4
const MIN_VISIBLE_ROWS = 3

const TONE: Readonly<Partial<Record<string, string>>> = {
  running:
    'border-busy/60 shadow-[0_0_--spacing(5.5)_rgb(var(--busy-rgb)/var(--fill-medium))]',
  fail: 'border-fail/60 hover:shadow-[0_10px_34px_rgb(var(--violet-rgb)/0.12)]',
}

type TTimelineDot = Readonly<{
  id: string
  xPct: number
  color: string
  title: string
  latest: boolean
}>

type TTimelineRow = Readonly<{
  owner: string
  color: string
  title: string
  dots: readonly TTimelineDot[]
}>

/**
 * Each card tails its own event stream: one full drain on mount, then the same
 * rowid-cursor poll the trace view uses — but only while the run is live. A
 * finished run's events cannot change, so polling it is pure waste on a page
 * that may hold fifty cards.
 */
const useCardEvents = (
  runId: string,
  running: boolean,
  workspace: string,
): readonly EventRow[] => {
  const [events, setEvents] = useState<readonly EventRow[]>([])
  const cursor = useRef(0)
  const inflight = useRef(false)

  useEffect(() => {
    let live = true

    const pull = async () => {
      if (inflight.current) return
      inflight.current = true
      try {
        let fresh: readonly EventRow[] = []
        let hasMore = true
        while (hasMore) {
          // Cursor pagination is inherently sequential: each request needs the
          // previous cursor.
          const page = await fetchEvents(runId, cursor.current, 1000, workspace)
          cursor.current = Math.max(cursor.current, page.cursor)
          fresh = [...fresh, ...page.events]
          hasMore = page.has_more
        }
        if (live && fresh.length > 0) {
          setEvents((previous) => [...previous, ...fresh])
        }
      } catch {
        /* the list view surfaces api errors; a card just retries next poll */
      } finally {
        inflight.current = false
      }
    }

    void pull()
    if (!running)
      return () => {
        live = false
      }

    const timer = setInterval(() => void pull(), 500)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [runId, running, workspace])

  return events
}

export const SessionCard = ({
  session,
  nowMs,
  workspaceRole,
  onArchived,
  onRefused,
}: Readonly<{
  session: SessionSummary
  nowMs: number
  /**
   * The colour this run's working tree wears, or absent when only one tree is
   * being watched — where the chip would say the same word on every card,
   * which is noise rather than information.
   */
  workspaceRole?: string
  /** Called with the id to drop, or '' when the write failed and a re-sync is needed. */
  onArchived: (runId: string) => void
  /** A refused write, in words — the list shows it with somewhere to fix it. */
  onRefused: (problem: string) => void
}>) => {
  const running = session.status === 'running'
  const events = useCardEvents(session.run_id, running, session.workspace)

  /**
   * The card is an <a> and the button lives inside it, so the click must not
   * navigate. The parent is told optimistically: the poll would take up to
   * half a second to drop the card, and a triage click should feel instant.
   */
  const archive = async (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onArchived(session.run_id)
    const result = await archiveSession(session.run_id, true, session.workspace)
    if (!result.ok) {
      /*
       * Put the card back AND say why. Restoring it silently was the whole
       * bug: a refused write looked exactly like a button that did nothing,
       * so the reader goes looking for a fault instead of for a token.
       */
      onArchived('')
      onRefused(result.problem)
    }
  }

  const range = useMemo(() => {
    const started = ts(session.started_at)
    const eventTimes = events
      .map((event) => ts(event.started_at))
      .filter(Number.isFinite)
    const t0 = Number.isFinite(started)
      ? started
      : eventTimes.length > 0
        ? Math.min(...eventTimes)
        : nowMs
    const ended = running ? nowMs : ts(session.ended_at)
    const t1 = Number.isFinite(ended)
      ? ended
      : eventTimes.length > 0
        ? Math.max(...eventTimes)
        : t0 + 1000
    return { t0, span: Math.max(t1 - t0, 1000) }
  }, [session.started_at, session.ended_at, events, running, nowMs])

  const ticks = useMemo(() => axisTicks(range.span, 5), [range.span])

  /** Per-agent rows: events attribute to an agent through their activity-run's owner. */
  const rows = useMemo<readonly TTimelineRow[]>(() => {
    let owners: string[] = []
    const ownerByActivityRun = new Map<string, string>()
    for (const activityRun of session.activityRuns ?? []) {
      if (activityRun.kind !== 'agent' || !activityRun.owner) continue
      ownerByActivityRun.set(activityRun.activity_run_id, activityRun.owner)
      if (!owners.includes(activityRun.owner))
        owners = [...owners, activityRun.owner]
    }
    if (owners.length === 0) return []

    const { t0, span } = range
    const byOwner = new Map<string, TTimelineDot[]>(owners.map((o) => [o, []]))
    let latestId = ''
    let latestAt = Number.NEGATIVE_INFINITY

    for (const event of events) {
      const owner = event.activity_run_id
        ? ownerByActivityRun.get(event.activity_run_id)
        : undefined
      const color = dotColor(event.type)
      if (!(owner && color)) continue
      const at = ts(event.started_at)
      if (!Number.isFinite(at)) continue
      byOwner.get(owner)?.push({
        id: event.event_id,
        xPct: Math.min(Math.max(((at - t0) / span) * 100, 0), 100),
        color,
        title: `${event.type} ${eventLabel(event)} at ${fmtOffset(at - t0)}`,
        latest: false,
      })
      if (at >= latestAt) {
        latestAt = at
        latestId = event.event_id
      }
    }

    /*
     * /api/sessions embeds agents so the labels can use config colours with no
     * extra request; historical sessions return color null → fallback palette.
     */
    return owners.map((owner, index) => {
      const info = (session.agents ?? []).find((a) => a.agent === owner)
      const dots = byOwner.get(owner) ?? []
      return {
        owner,
        color: agentColor(info?.color, null, index),
        title: info?.model ? `${owner} ${info.model}` : owner,
        dots: running
          ? dots.map((dot) =>
              dot.id === latestId ? { ...dot, latest: true } : dot,
            )
          : dots,
      }
    })
  }, [session.activityRuns, session.agents, events, range, running])

  const durationMs = useMemo(() => {
    const start = ts(session.started_at)
    if (!Number.isFinite(start)) return Number.NaN
    const end = running ? nowMs : ts(session.ended_at)
    return (Number.isFinite(end) ? end : nowMs) - start
  }, [session.started_at, session.ended_at, running, nowMs])

  const overflowing = rows.length > MAX_VISIBLE_ROWS
  const visibleRows = overflowing ? rows.slice(0, MIN_VISIBLE_ROWS) : rows
  const hiddenRowCount = overflowing ? rows.length - MIN_VISIBLE_ROWS : 0

  return (
    <a
      className={cx(
        'group @container relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-2xl border-[length:var(--border-width)] bg-surface bg-[image:var(--surface)] p-5 text-text! transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:shadow-[var(--ring)] focus-visible:outline-none',
        TONE[session.status ?? ''] ??
          'border-border-soft hover:border-violet/45 hover:shadow-[0_10px_34px_rgb(var(--violet-rgb)/0.12)]',
      )}
      href={hrefFor(session.run_id, undefined, session.workspace)}
    >
      <button
        className="absolute top-2.5 right-3 size-7 cursor-pointer rounded-lg border-0 bg-transparent p-0 font-sans text-xl leading-none text-dim opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-fail/16 hover:text-fail focus-visible:opacity-100 pointer-coarse:opacity-100"
        type="button"
        title="Archive — remove this run from review"
        aria-label="Archive run"
        onClick={archive}
      >
        ×
      </button>
      <span className="flex-none truncate font-mono text-lg leading-normal font-bold text-purple">
        {session.run_id}
      </span>
      {/*
        Which tree this ran in. Only when several are watched: with one, it is
        the same word on every card, which is noise rather than information.
      */}
      {workspaceRole !== undefined && (
        <span
          className="max-w-full flex-none self-start truncate rounded-full px-2 py-0.5 font-mono text-xs leading-normal"
          style={{
            color: paletteColor(workspaceRole),
            background: paletteColor(workspaceRole, 0.14),
          }}
          title={session.workspace_root ?? session.workspace}
        >
          {session.branch ?? session.workspace}
        </span>
      )}
      <span
        className="flex-none truncate font-mono text-base text-cyan"
        title={session.name ?? session.lifecycle ?? ''}
      >
        {session.name || session.lifecycle || '—'}
      </span>
      <span
        className="flex-none truncate text-base text-text"
        title={session.request ?? ''}
      >
        {session.request}
      </span>

      {rows.length > 0 ? (
        <div className="mt-1 flex min-h-48 flex-none flex-col">
          <div className="mb-1.5 flex h-7 items-end">
            <span className="w-24 flex-none truncate pr-2" />
            <span className="relative h-full min-w-0 flex-1 border-b-[length:var(--border-width)] border-border">
              {ticks.map((tick) => (
                <span
                  key={tick.label}
                  className={cx(
                    'absolute bottom-1 font-mono text-base whitespace-nowrap text-faint',
                    tick.pct === 0 ? 'translate-x-0' : '-translate-x-1/2',
                  )}
                  style={{ left: `${tick.pct}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </span>
          </div>
          {visibleRows.map((row) => (
            <div key={row.owner} className="flex h-10 items-center">
              <span
                className="w-24 flex-none truncate pr-2 text-base text-dim"
                style={{ color: paletteColor(row.color) }}
                title={row.title}
              >
                {row.owner}
              </span>
              <span className="relative h-full min-w-0 flex-1 border-b-[length:var(--border-width)] border-border-soft">
                {row.dots.map((dot) => (
                  <span
                    key={dot.id}
                    className={cx(
                      'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                      dot.latest
                        ? 'size-3 animate-[crust-pulse_1.4s_ease-in-out_infinite] shadow-[0_0_--spacing(2.5)_currentColor]'
                        : 'size-2',
                    )}
                    style={{
                      left: `${dot.xPct}%`,
                      background: paletteColor(dot.color),
                    }}
                    title={dot.title}
                  />
                ))}
              </span>
            </div>
          ))}
          {hiddenRowCount > 0 && (
            <div className="flex h-10 items-center pl-24 text-base text-dim">
              +{hiddenRowCount} more agents
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1 flex min-h-48 flex-none items-center justify-center text-base text-faint">
          no agent activity yet
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-base">
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2">
          <StatusChip status={session.status ?? 'fail'} />
          <ActivityRunDots activityRuns={session.activityRuns ?? []} />
        </span>
        <span className="text-dim">{fmtDate(session.started_at)}</span>
      </div>
      <div
        className="flex flex-wrap items-center gap-3"
        data-testid="session-stats"
      >
        <StatChip kind="cost" value={session.total_cost ?? undefined} />
        <StatChip kind="runtime" value={durationMs} />
        <StatChip kind="tokens" value={session.total_tokens ?? undefined} />
      </div>
    </a>
  )
}
