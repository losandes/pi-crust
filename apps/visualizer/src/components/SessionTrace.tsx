import { Bot, SquareTerminal, UserRound } from 'lucide-react'
import type { ComponentType, CSSProperties } from 'react'
import { useMemo } from 'react'
import { agentColor, hexAlpha, parseAgentStart } from '../lib/events'
import { axisTicks, fmtDate, payloadOk, ts } from '../lib/format'
import { modelIcon, modelName } from '../lib/models'
import { navigate } from '../lib/router'
import type {
  AgentStartPayload,
  EventRow,
  ActivityRun,
  ActivityRunKind,
} from '../lib/types'
import { useTrace } from '../lib/use-trace'
import {
  blockLayout,
  contextFill,
  contextLabel,
  laneContext,
  originMs as postOriginMs,
  REQ_ZONE_PCT,
  timeRange,
  toolTickPositions,
  type TLaneContext,
} from '../lib/waterfall'
import { DecisionRequest } from './DecisionRequest'
import { RunControls } from './RunControls'
import { SessionContext } from './SessionContext'
import { ActivityRunDetail } from './ActivityRunDetail'
import { StatChip } from './StatChip'
import { StatusChip } from './StatusChip'
import { TreeWarnings } from './TreeWarnings'
import { RunNotices } from './RunNotices'
import { runNoticesOf } from '../lib/notices'
import { warningsIn } from '../lib/warnings'
import styles from './SessionTrace.module.css'
import { paletteColor } from '../lib/palette'

// The two lanes nobody configures: the request itself, and the code activityRuns
// that run without an agent. Roles like every other lane, so they re-theme
// with the rest rather than staying dark-theme amber on a white page.
const ENGINEER_COLOR = 'amber'
const CODE_COLOR = 'teal'

type TIconProps = Readonly<{ size?: number; strokeWidth?: number; className?: string }>

const KIND_ICONS: Readonly<Record<ActivityRunKind, ComponentType<TIconProps>>> = {
  engineer: UserRound,
  code: SquareTerminal,
  agent: Bot,
}

const STATUS_GLYPH: Readonly<Record<string, string>> = {
  success: '\u2713',
  fail: '\u2717',
  running: '\u25cf',
  queued: '\u25cb',
}

const NUM = new Intl.NumberFormat('en-US')

type TLane = Readonly<{
  id: string
  label: string
  /** Model driving this lane's agent — rendered with its provider icon. */
  model: string | undefined
  /** Context-window occupancy, or undefined while unknown (running / old db). */
  context: TLaneContext | undefined
  metaLines: readonly string[]
  color: string
  kind: ActivityRunKind
  activityRuns: readonly ActivityRun[]
}>

/**
 * A live agent's model, thinking level and colour arrive on its agent_start
 * event before any agent_sessions row exists, so each start is attributed to
 * its activity-run's owner.
 */
const startsByOwner = (
  activityRuns: readonly ActivityRun[],
  events: readonly EventRow[],
): Readonly<Record<string, AgentStartPayload>> => {
  const ownerByActivityRun = new Map(activityRuns.map((p) => [p.activity_run_id, p.owner]))
  // The FIRST agent_start per owner wins, so a Set of owners already claimed
  // decides what the later map/filter keeps, and the final object is built
  // once from entries rather than one field at a time with a growing spread.
  const claimed = new Set<string>()
  const entries = events.flatMap((event): readonly [string, AgentStartPayload][] => {
    if (event.type !== 'agent_start') return []
    const owner = (event.activity_run_id ? ownerByActivityRun.get(event.activity_run_id) : null) ?? event.name
    if (!owner || claimed.has(owner)) return []
    const payload = parseAgentStart(event)
    if (!payload) return []
    claimed.add(owner)
    return [[owner, payload]]
  })
  return Object.fromEntries(entries)
}

export const SessionTrace = ({
  runId,
  workspace,
  activityRunId,
}: Readonly<{
  runId: string
  activityRunId: string | undefined
  /** The tree this run is in, when the link said. Carried on every request. */
  workspace: string | undefined
}>) => {
  const trace = useTrace(runId, workspace)
  const { session, handoffDir, activityRuns, agents, events, nowMs } = trace
  const running = session?.status === 'running'

  const selectedActivityRun = activityRuns.find((p) => p.activity_run_id === activityRunId)

  const lanes = useMemo<readonly TLane[]>(() => {
    const starts = startsByOwner(activityRuns, events)
    const agentOwners = [
      ...new Set(
        activityRuns
          .filter((activityRun) => activityRun.kind === 'agent' && activityRun.owner)
          .map((activityRun) => activityRun.owner as string),
      ),
    ]
    const codeActivityRuns = activityRuns.filter((p) => p.kind === 'code')

    const engineerLane: TLane = {
      id: 'engineer',
      label: session?.engineer ?? 'engineer',
      model: undefined,
      context: undefined,
      metaLines: ['engineer'],
      color: ENGINEER_COLOR,
      kind: 'engineer',
      activityRuns: activityRuns.filter((p) => p.kind === 'engineer'),
    }

    const codeLane: readonly TLane[] =
      codeActivityRuns.length > 0
        ? [
            {
              id: 'code',
              label: 'code',
              model: undefined,
              context: undefined,
              metaLines: ['workspace'],
              color: CODE_COLOR,
              kind: 'code',
              activityRuns: codeActivityRuns,
            },
          ]
        : []

    const agentLanes = agentOwners.map((owner, index): TLane => {
      const info = agents.find((a) => a.agent === owner)
      const start = starts[owner]
      return {
        id: `agent:${owner}`,
        // The model is the lane's whole story; thinking level lives in the
        // activityRun detail's agent config section.
        model: info?.model ?? start?.model ?? undefined,
        label: owner,
        context: laneContext(info?.context_tokens, info?.context_window),
        metaLines: [],
        color: agentColor(info?.color, start?.color, index),
        kind: 'agent',
        activityRuns: activityRuns.filter((p) => p.kind === 'agent' && p.owner === owner),
      }
    })

    return [engineerLane, ...codeLane, ...agentLanes]
  }, [activityRuns, agents, events, session?.engineer])

  const range = useMemo(
    () => timeRange(activityRuns, session?.started_at, session?.ended_at, running, nowMs),
    [activityRuns, session?.started_at, session?.ended_at, running, nowMs],
  )

  const requestActivityRun = activityRuns.find((p) => p.kind === 'engineer' && p.started_at)
  const zonePct = requestActivityRun === undefined ? 0 : REQ_ZONE_PCT
  const origin = useMemo(
    () => postOriginMs(activityRuns, requestActivityRun, range),
    [activityRuns, requestActivityRun, range],
  )
  const postSpan = Math.max(range.t1 - origin, 1000)

  const ticks = useMemo(
    () =>
      axisTicks(postSpan, 7).map((tick) => ({
        pct: zonePct + (tick.pct * (100 - zonePct)) / 100,
        label: tick.label,
      })),
    [postSpan, zonePct],
  )

  const layout = useMemo(
    () =>
      blockLayout(activityRuns, {
        zonePct,
        originMs: origin,
        spanMs: postSpan,
        requestActivityRunId: requestActivityRun?.activity_run_id,
        nowMs,
      }),
    [activityRuns, zonePct, origin, postSpan, requestActivityRun?.activity_run_id, nowMs],
  )

  /** Tool-call marks per activityRun, read once rather than per block. */
  const marksByActivityRun = useMemo(() => {
    const map = new Map<string, readonly { id: string; t: number; ok: boolean }[]>()
    for (const event of events) {
      if (event.type !== 'tool_call' || !event.activity_run_id) continue
      const marks = map.get(event.activity_run_id) ?? []
      map.set(event.activity_run_id, [
        ...marks,
        {
          id: event.event_id,
          t: ts(event.started_at),
          ok: payloadOk(event.payload_json),
        },
      ])
    }
    return map
  }, [events])

  const blockGeom = (activityRun: ActivityRun): { left: string; width: string } | undefined => {
    // The request block fills its reserved zone; nothing else ever enters it.
    if (activityRun.activity_run_id === requestActivityRun?.activity_run_id && zonePct > 0) {
      return { left: '0.4%', width: `${zonePct - 0.8}%` }
    }
    const geom = layout[activityRun.activity_run_id]
    return geom === undefined
      ? undefined
      : { left: `${geom.left}%`, width: `${geom.width}%` }
  }

  const blockStyle = (activityRun: ActivityRun, lane: TLane): CSSProperties | undefined => {
    const geom = blockGeom(activityRun)
    if (geom === undefined) return undefined
    return {
      left: geom.left,
      width: geom.width,
      background: `linear-gradient(180deg, ${hexAlpha(lane.color, 0.2)}, ${hexAlpha(lane.color, 0.05)})`,
      borderColor:
        activityRun.status === 'fail'
          ? 'rgb(var(--fail-rgb) / 0.8)'
          : hexAlpha(lane.color, 0.55),
      '--lane-glow': hexAlpha(lane.color, 0.28),
    } as CSSProperties
  }

  const blockDurationMs = (activityRun: ActivityRun): number => {
    const start = ts(activityRun.started_at)
    if (!Number.isFinite(start)) return Number.NaN
    const end = activityRun.status === 'running' ? nowMs : ts(activityRun.ended_at)
    return Number.isFinite(end) ? end - start : Number.NaN
  }

  const sessionDurationMs = useMemo(() => {
    const start = ts(session?.started_at)
    if (!Number.isFinite(start)) return Number.NaN
    const end = running ? nowMs : ts(session?.ended_at)
    return (Number.isFinite(end) ? end : nowMs) - start
  }, [session?.started_at, session?.ended_at, running, nowMs])

  const selectActivityRun = (activityRun: ActivityRun) =>
    navigate(
      runId,
      activityRun.activity_run_id === activityRunId ? undefined : activityRun.activity_run_id,
      workspace,
    )

  return (
    <div className={styles.trace}>
      {trace.error !== undefined && (
        <div className="error-bar">api unreachable — retrying {trace.error}</div>
      )}

      {session !== undefined && (
        <div className={styles.runStrip}>
          <span className={styles.request} title={session.request ?? ''}>
            {session.request}
          </span>
          <StatusChip status={session.status ?? 'fail'} />
          <span className="dim">started {fmtDate(session.started_at)}</span>
          <span className={styles.runStats}>
            <StatChip kind="cost" value={session.total_cost ?? undefined} />
            <StatChip kind="runtime" value={sessionDurationMs} />
            <StatChip kind="tokens" value={session.total_tokens ?? undefined} />
            <StatChip kind="read" value={trace.usage.read} />
            <StatChip kind="written" value={trace.usage.written} />
          </span>
        </div>
      )}

      {activityRuns.length > 0 ? (
        <div className={styles.waterfall}>
          <div className={`${styles.row} ${styles.axisRow}`}>
            <div className={styles.label} />
            <div className={styles.track}>
              {zonePct > 0 && (
                <span className={styles.zoneHead} style={{ width: `${zonePct}%` }}>
                  request
                </span>
              )}
              {ticks.map((tick) => (
                <span
                  key={`${tick.label}-${tick.pct}`}
                  className={styles.axisLabel}
                  style={{ left: `${tick.pct}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>

          {lanes.map((lane) => {
            const KindIcon = KIND_ICONS[lane.kind]
            const icon = lane.model === undefined ? null : modelIcon(lane.model)
            const queued = lane.activityRuns.filter((p) => !p.started_at)
            return (
              <div key={lane.id} className={`${styles.row} ${styles.lane}`}>
                <div className={styles.label}>
                  <span className={styles.laneName} style={{ color: paletteColor(lane.color) }}>
                    <KindIcon className={styles.laneIcon} size={22} strokeWidth={2} />
                    {lane.label}
                  </span>
                  {lane.model !== undefined && (
                    <span
                      className={`${styles.laneMeta} ${styles.laneModel}`}
                      title={lane.model}
                    >
                      {icon !== null && (
                        <img className={styles.modelIcon} src={icon} alt="" />
                      )}
                      {modelName(lane.model)}
                    </span>
                  )}
                  {lane.context !== undefined && (
                    <span
                      className={styles.laneCtx}
                      title={`${NUM.format(lane.context.used)} / ${NUM.format(lane.context.window)} tokens used · ${NUM.format(lane.context.window - lane.context.used)} remaining`}
                    >
                      <span className={styles.ctxHead}>
                        <span className={styles.ctxLabel}>Context</span>
                        <span className={styles.ctxPct}>{contextLabel(lane.context)}</span>
                      </span>
                      <span className={styles.ctxBar}>
                        <span
                          className={styles.ctxFill}
                          style={{
                            width: contextFill(lane.context),
                            background: `linear-gradient(90deg, ${hexAlpha(lane.color, 0.55)}, ${paletteColor(lane.color)})`,
                            boxShadow: `0 0 10px ${hexAlpha(lane.color, 0.45)}`,
                          }}
                        />
                      </span>
                    </span>
                  )}
                  {lane.metaLines.map((line) => (
                    <span key={line} className={styles.laneMeta}>
                      {line}
                    </span>
                  ))}
                </div>
                <div className={styles.track}>
                  {zonePct > 0 && (
                    <span className={styles.zoneDivider} style={{ left: `${zonePct}%` }} />
                  )}
                  {ticks.map((tick) => (
                    <span
                      key={`grid-${tick.label}-${tick.pct}`}
                      className={styles.gridline}
                      style={{ left: `${tick.pct}%` }}
                    />
                  ))}
                  {lane.activityRuns
                    .filter((activityRun) => blockGeom(activityRun) !== undefined)
                    .map((activityRun) => {
                      const duration = blockDurationMs(activityRun)
                      const tone = styles[activityRun.status ?? '']
                      const selected = activityRun.activity_run_id === activityRunId
                      return (
                        <button
                          key={activityRun.activity_run_id}
                          type="button"
                          className={[
                            styles.block,
                            tone,
                            selected ? styles.selected : undefined,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={blockStyle(activityRun, lane)}
                          title={`${activityRun.name} — ${activityRun.status}${activityRun.description ? `\n${activityRun.description}` : ''}`}
                          onClick={() => selectActivityRun(activityRun)}
                        >
                          <span className={styles.blockTop}>
                            <span className={`${styles.blockStatus} ${tone ?? ''}`}>
                              {STATUS_GLYPH[activityRun.status ?? ''] ?? '\u25cb'}
                            </span>
                            <span className={styles.blockName}>{activityRun.name}</span>
                            {Number.isFinite(duration) && (
                              <StatChip kind="runtime" compact value={duration} />
                            )}
                          </span>
                          <span className={styles.blockDesc}>{activityRun.description}</span>
                          {toolTickPositions(
                            activityRun,
                            marksByActivityRun.get(activityRun.activity_run_id) ?? [],
                            nowMs,
                          ).map((mark) => (
                            <span
                              key={mark.id}
                              className={mark.ok ? styles.toolTick : `${styles.toolTick} ${styles.err}`}
                              style={{ left: `${mark.x}%` }}
                            />
                          ))}
                        </button>
                      )
                    })}
                  {queued.map((activityRun, index) => (
                    <button
                      key={activityRun.activity_run_id}
                      type="button"
                      className={[
                        styles.block,
                        styles.queued,
                        activityRun.activity_run_id === activityRunId ? styles.selected : undefined,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ right: `${10 + index * 5}px`, width: '170px' }}
                      title={`${activityRun.name} — queued`}
                      onClick={() => selectActivityRun(activityRun)}
                    >
                      <span className={styles.blockTop}>
                        <span className={`${styles.blockStatus} ${styles.queued}`}>
                          {'\u25cb'}
                        </span>
                        <span className={styles.blockName}>{activityRun.name}</span>
                      </span>
                      <span className={styles.blockDesc}>queued</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : trace.loaded ? (
        <div className="empty-state">no activityRuns recorded for this session</div>
      ) : trace.error === undefined ? (
        <div className="empty-state">loading trace…</div>
      ) : undefined}

      {/*
        Below the waterfall, not above it.

        It sat above because a question should be where the eye lands first,
        which was true of an empty page and false of this one: the chart is
        the thing being read, and pushing it down the screen to make room for
        the question moved the subject to make room for the footnote. The
        waiting status is already impossible to miss in the header chip.

        The question still comes before the controls that answer it.
      */}
      {session !== undefined && selectedActivityRun === undefined && (
        <>
          <RunNotices notices={runNoticesOf(events)} workspace={workspace} />
          <DecisionRequest
            runId={runId}
            status={session.status ?? ''}
            workspace={workspace}
            standalone
          />
          {/*
            Controls only while there is something to control. On a finished
            run this card said "there is nobody to talk to" above a disabled
            field — a whole card to say nothing can be done. What CAN be done
            is asking a activity, and that belongs on the activity, where the
            conversation it continues is.
          */}
          {(session.status === 'running' || session.status === 'waiting') && (
            <RunControls
              runId={runId}
              status={session.status ?? ''}
              workspace={workspace}
              standalone
            />
          )}
          {/*
            The run's own context, under the conversation: what was asked,
            and every document the run produced. A activity has its context in a
            tab because it has fifteen kinds; a run has two, so folding them
            would only cost a click.
          */}
          <SessionContext
            session={session}
            runId={runId}
            workspace={workspace}
            handoffDir={handoffDir}
            envelopes={trace.envelopes}
            events={events}
          />
          {/*
            Everything the run saw in the working tree and could not
            attribute. On the run rather than on an Activity, because a
            reader with nothing selected is asking what happened to the
            repository, and a warning raised by the second of nine
            Activities is still the answer when the ninth has finished.
          */}
          <TreeWarnings warnings={warningsIn(events)} standalone />
        </>
      )}

      {/*
        One agent at a time, chosen by the Gantt. Sankey curves across three
        concurrent agents interleaved by timestamp would be noise rather than
        insight, so the selected activityRun decides whose conversation is on screen.
      */}
      {selectedActivityRun !== undefined && (
        <ActivityRunDetail
          activityRun={selectedActivityRun}
          runId={runId}
          runStatus={session?.status ?? ''}
          events={events}
          envelopes={trace.envelopes}
          gates={trace.gates}
          activityRuns={activityRuns}
          workspace={workspace}
          onClose={() => navigate(runId, undefined, workspace)}
        />
      )}
    </div>
  )
}
