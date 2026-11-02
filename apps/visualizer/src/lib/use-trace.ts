import { useCallback, useEffect, useState } from 'react'
import { fetchEnvelopes, fetchEvents, fetchGates, fetchSession } from './api'
import { byStart } from './order'
import type {
  ActivityRun,
  AgentSession,
  Envelope,
  EventRow,
  GateResult,
  Session,
  SessionUsage,
} from './types'

/**
 * Envelopes and gates only gain rows around activityRun and agent boundaries, so
 * they are refetched on those events rather than twice a second.
 */
const SIDE_TABLE_TYPES = new Set([
  'gate_pass',
  'gate_fail',
  'handoff',
  'agent_end',
  'activity_run_end',
  'error',
])

export type TTrace = Readonly<{
  session: Session | undefined
  /** This run's handoff directory, resolved absolute by the server. */
  handoffDir: string | undefined
  activityRuns: readonly ActivityRun[]
  agents: readonly AgentSession[]
  usage: SessionUsage
  events: readonly EventRow[]
  envelopes: readonly Envelope[]
  gates: readonly GateResult[]
  error: string | undefined
  loaded: boolean
  nowMs: number
}>

const EMPTY_USAGE: SessionUsage = { read: 0, written: 0 }

/**
 * One run's complete state, tailed live.
 *
 * Events arrive by rowid cursor and accumulate; everything else is replaced
 * wholesale each tick. The cursor lives in a ref rather than state because
 * advancing it must not itself cause a render — it is bookkeeping about what
 * has been read, not something the screen shows.
 */
export const useTrace = (runId: string, workspace?: string): TTrace => {
  const [trace, setTrace] = useState<TTrace>({
    session: undefined,
    handoffDir: undefined,
    activityRuns: [],
    agents: [],
    usage: EMPTY_USAGE,
    events: [],
    envelopes: [],
    gates: [],
    error: undefined,
    loaded: false,
    nowMs: Date.now(),
  })

  /*
   * The poll's bookkeeping belongs to ONE effect instance, not to the hook.
   *
   * As refs, the cursor and the in-flight flag were shared across instances,
   * and React mounts every effect twice in development. The second instance
   * reset the cursor, found the first instance's `inflight` still true and
   * returned; the first then paged to the end, advanced the shared cursor, and
   * threw its results away because it was no longer alive. From then on the
   * poll asked for events after a cursor nothing would ever follow.
   *
   * On a LIVE run that healed itself — new events kept arriving past the
   * cursor. On a FINISHED one it did not: the trace stayed empty forever, so
   * the narration pane said "nothing recorded" about a activityRun with 23 rows in
   * the database.
   */
  const poll = useCallback(
    (runIdForPoll: string, workspaceForPoll?: string) => {
      const state = { cursor: 0, inflight: false, loaded: false }
      return async (live: () => boolean) => {
        const runId = runIdForPoll
        // Carried on every request of the tick, so a run cannot be read from one
        // tree and its events from another.
        const workspace = workspaceForPoll
        if (state.inflight) return
        state.inflight = true
        try {
          const detail = await fetchSession(runId, workspace)

          const fresh: EventRow[] = []
          let hasMore = true
          while (hasMore) {
            // Cursor pagination is inherently sequential: each request needs the
            // previous cursor.
            const page = await fetchEvents(runId, state.cursor, 1000, workspace)
            state.cursor = Math.max(state.cursor, page.cursor)
            fresh.push(...page.events)
            hasMore = page.has_more
          }

          const boundaryCrossed = fresh.some(
            (event) => event.type !== null && SIDE_TABLE_TYPES.has(event.type),
          )
          /*
           * A fixed pair where both values are required: if either side table
           * cannot be read, the panel has nothing partial to show, and the catch
           * below surfaces it as the API error it is.
           */
          const sideTables =
            !state.loaded || boundaryCrossed
              ? // biome-ignore lint/plugin: fixed tuple, both values required
                await Promise.all([
                  fetchEnvelopes(runId, workspace),
                  fetchGates(runId, workspace),
                ])
              : undefined

          if (!live()) return
          state.loaded = true
          setTrace((previous) => ({
            session: detail.session,
            handoffDir: detail.handoff_dir,
            activityRuns: detail.activityRuns.toSorted(byStart),
            agents: detail.agents,
            usage: detail.usage,
            events:
              fresh.length > 0
                ? [...previous.events, ...fresh]
                : previous.events,
            envelopes: sideTables?.[0] ?? previous.envelopes,
            gates: sideTables?.[1] ?? previous.gates,
            error: undefined,
            loaded: true,
            nowMs: Date.now(),
          }))
        } catch (cause) {
          if (!live()) return
          setTrace((previous) => ({
            ...previous,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
        } finally {
          state.inflight = false
        }
      }
    },
    [],
  )

  useEffect(() => {
    let alive = true
    const live = () => alive
    // One tick function per mount, with its own cursor.
    const tick = poll(runId, workspace)

    void tick(live)
    const timer = setInterval(() => void tick(live), 500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [poll, runId, workspace])

  return trace
}
