import { Bot, SquareTerminal, UserRound } from 'lucide-react'
import type { ComponentProps, ComponentType, CSSProperties } from 'react'
import { useMemo } from 'react'
import type {
  ActivityRun,
  ActivityRunKind,
  ActivityRunDetail as LiveActivityRunDetail,
  TreeWarnings as LiveTreeWarnings,
  warningsIn as liveWarningsIn,
} from '@/domains/activity-runs'
import type {
  DecisionRequest as LiveDecisionRequest,
  sendDecision as liveSendDecision,
} from '@/domains/decisions'
import type { AgentStartPayload, EventRow } from '@/domains/events'
import { agentColor, hexAlpha, parseAgentStart } from '@/domains/events'
import type { SessionContext as LiveSessionContext } from '@/domains/handoff'
import { RunControls } from '@/domains/run-controls'
import { ErrorBar, StatChip, StatusChip } from '@/lib/_components'
import { cx } from '@/lib/cx'
import { axisTicks, fmtDate, payloadOk, ts } from '@/lib/format'
import { modelIcon, modelName } from '@/lib/models'
import { paletteColor } from '@/lib/palette'
import { navigate } from '@/lib/router'
import { runNoticesOf } from '../usecases/notices'
import { resolveBranchLabel } from '../usecases/resolve-branch-label'
import { resolveRepositoryLabel } from '../usecases/resolve-repository-label'
import { taskBlocks } from '../usecases/task-blocks'
import type { TTrace } from '../usecases/use-trace'
import {
  blockLayout,
  contextFill,
  contextLabel,
  laneContext,
  originMs as postOriginMs,
  REQ_ZONE_PCT,
  type TLaneContext,
  timeRange,
  toolTickPositions,
} from '../usecases/waterfall'

import { RunNotices } from './RunNotices'

// The two lanes nobody configures: the request itself, and the code activityRuns
// that run without an agent. Roles like every other lane, so they re-theme
// with the rest rather than staying dark-theme amber on a white page.
const ENGINEER_COLOR = 'amber'
const CODE_COLOR = 'teal'

type TIconProps = Readonly<{
  size?: number
  strokeWidth?: number
  className?: string
}>

const KIND_ICONS: Readonly<Record<ActivityRunKind, ComponentType<TIconProps>>> =
  {
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

const ROW = 'grid grid-cols-1 md:grid-cols-[18rem_1fr]'
const LABEL =
  'flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden border-r-[length:var(--border-width)] border-border px-4 py-3 whitespace-nowrap'
const TRACK = 'relative min-h-30 min-w-0 overflow-hidden'
const LANE_META = 'truncate font-mono text-base text-dim'
// Issue #171 SC3: unchanged appearance; the removed rule supplied the native button font.
const BLOCK =
  '[font-family:revert] absolute top-3 flex min-h-23 cursor-pointer flex-col justify-start gap-1 overflow-hidden rounded-xl border-[length:var(--border-width)] px-3 pt-2.5 pb-4 text-left text-base leading-[normal] whitespace-nowrap transition-shadow duration-160 ease-[ease]'
const BLOCK_HOVER =
  'hover:shadow-[0_0_--spacing(4.5)_var(--lane-glow,rgb(var(--busy-rgb)/0.2))]'
const BLOCK_SELECTED =
  'shadow-[0_0_--spacing(5.5)_var(--lane-glow,rgb(var(--busy-rgb)/0.25))] outline-2 outline-offset-2 outline-blue'
const BLOCK_TONES: Readonly<Partial<Record<string, string>>> = {
  running: 'animate-[crust-pulse_1.6s_ease-in-out_infinite] text-text',
  queued: 'border-dashed border-faint bg-transparent text-dim',
}
const STATUS_TONES: Readonly<Partial<Record<string, string>>> = {
  success: 'text-green',
  fail: 'text-red',
  running: 'animate-[crust-pulse_1.2s_ease-in-out_infinite] text-blue',
  queued: 'text-faint',
}
const TOOL_TICK = 'absolute bottom-1 h-2.5 w-0.5 rounded-xs'
const EMPTY_STATE = 'px-6 py-14 text-center text-base text-dim'

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
  const ownerByActivityRun = new Map(
    activityRuns.map((p) => [p.activity_run_id, p.owner]),
  )
  // The FIRST agent_start per owner wins, so a Set of owners already claimed
  // decides what the later map/filter keeps, and the final object is built
  // once from entries rather than one field at a time with a growing spread.
  const claimed = new Set<string>()
  const entries = events.flatMap(
    (event): readonly [string, AgentStartPayload][] => {
      if (event.type !== 'agent_start') return []
      const owner =
        (event.activity_run_id
          ? ownerByActivityRun.get(event.activity_run_id)
          : null) ?? event.name
      if (!owner || claimed.has(owner)) return []
      const payload = parseAgentStart(event)
      if (!payload) return []
      claimed.add(owner)
      return [[owner, payload]]
    },
  )
  return Object.fromEntries(entries)
}

export type TSessionTraceDeps = Readonly<{
  useTrace: (runId: string, workspace?: string) => TTrace
  ActivityRunDetail: ComponentType<ComponentProps<typeof LiveActivityRunDetail>>
  DecisionRequest: ComponentType<ComponentProps<typeof LiveDecisionRequest>>
  SessionContext: ComponentType<ComponentProps<typeof LiveSessionContext>>
  TreeWarnings: ComponentType<ComponentProps<typeof LiveTreeWarnings>>
  warningsIn: typeof liveWarningsIn
  sendDecision: typeof liveSendDecision
}>

export const createSessionTrace =
  ({
    useTrace,
    ActivityRunDetail,
    DecisionRequest,
    SessionContext,
    TreeWarnings,
    warningsIn,
    sendDecision,
  }: TSessionTraceDeps) =>
  ({
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
    const tasks = useMemo(
      () => taskBlocks(events, activityRuns, running),
      [events, activityRuns, running],
    )
    const chartRuns = useMemo(
      () => [...activityRuns, ...tasks.map(({ block }) => block)],
      [activityRuns, tasks],
    )

    const selectedActivityRun = activityRuns.find(
      (p) => p.activity_run_id === activityRunId,
    )

    const lanes = useMemo<readonly TLane[]>(() => {
      const starts = startsByOwner(activityRuns, events)
      const agentOwners = [
        ...new Set(
          activityRuns
            .filter(
              (activityRun) =>
                activityRun.kind === 'agent' && activityRun.owner,
            )
            .map((activityRun) => activityRun.owner as string),
        ),
      ]
      const codeActivityRuns = chartRuns.filter((p) => p.kind === 'code')

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
          activityRuns: activityRuns.filter(
            (p) => p.kind === 'agent' && p.owner === owner,
          ),
        }
      })

      return [engineerLane, ...codeLane, ...agentLanes]
    }, [activityRuns, chartRuns, agents, events, session?.engineer])

    const range = useMemo(
      () =>
        timeRange(
          chartRuns,
          session?.started_at,
          session?.ended_at,
          running,
          nowMs,
        ),
      [chartRuns, session?.started_at, session?.ended_at, running, nowMs],
    )

    const requestActivityRun = activityRuns.find(
      (p) => p.kind === 'engineer' && p.started_at,
    )
    const zonePct = requestActivityRun === undefined ? 0 : REQ_ZONE_PCT
    const origin = useMemo(
      () => postOriginMs(chartRuns, requestActivityRun, range),
      [chartRuns, requestActivityRun, range],
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
        blockLayout(chartRuns, {
          zonePct,
          originMs: origin,
          spanMs: postSpan,
          requestActivityRunId: requestActivityRun?.activity_run_id,
          nowMs,
        }),
      [
        chartRuns,
        zonePct,
        origin,
        postSpan,
        requestActivityRun?.activity_run_id,
        nowMs,
      ],
    )

    /** Tool-call marks per activityRun, read once rather than per block. */
    const marksByActivityRun = useMemo(() => {
      const map = new Map<
        string,
        readonly { id: string; t: number; ok: boolean }[]
      >()
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

    const blockGeom = (
      activityRun: ActivityRun,
    ): { left: string; width: string } | undefined => {
      // The request block fills its reserved zone; nothing else ever enters it.
      if (
        activityRun.activity_run_id === requestActivityRun?.activity_run_id &&
        zonePct > 0
      ) {
        return { left: '0.4%', width: `${zonePct - 0.8}%` }
      }
      const geom = layout[activityRun.activity_run_id]
      return geom === undefined
        ? undefined
        : { left: `${geom.left}%`, width: `${geom.width}%` }
    }

    const blockStyle = (
      activityRun: ActivityRun,
      lane: TLane,
    ): CSSProperties | undefined => {
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
      const end =
        activityRun.status === 'running' ? nowMs : ts(activityRun.ended_at)
      return Number.isFinite(end) ? end - start : Number.NaN
    }

    const sessionDurationMs = useMemo(() => {
      const start = ts(session?.started_at)
      if (!Number.isFinite(start)) return Number.NaN
      const end = running ? nowMs : ts(session?.ended_at)
      return (Number.isFinite(end) ? end : nowMs) - start
    }, [session?.started_at, session?.ended_at, running, nowMs])

    const selectActivityRun = (activityRun: ActivityRun) => {
      const task = tasks.find(
        ({ block }) => block.activity_run_id === activityRun.activity_run_id,
      )
      const selects =
        task === undefined ? activityRun.activity_run_id : task.selects
      if (selects === undefined) return
      navigate(
        runId,
        selects === activityRunId ? undefined : selects,
        workspace,
      )
    }

    return (
      <div className="pb-10">
        {trace.error !== undefined && (
          <ErrorBar message={`api unreachable — retrying ${trace.error}`} />
        )}

        {session !== undefined && (
          <div className="flex flex-wrap items-center gap-4 border-b-[length:var(--border-width)] border-border-soft px-6 py-3.5">
            <span
              className="min-w-0 max-w-[52ch] truncate text-[17px] text-text"
              title={session.request ?? ''}
            >
              {session.request}
            </span>
            <StatusChip status={session.status ?? 'fail'} />
            <span
              data-testid="session-repository"
              title={session.repository_root || 'repository not recorded'}
              className="truncate text-dim"
            >
              {resolveRepositoryLabel(session)}
            </span>
            <span
              className="max-w-full min-w-0 truncate rounded-full bg-panel-2 px-2 py-0.5 font-mono text-xs leading-normal text-dim"
              data-testid="session-branch"
              title={resolveBranchLabel(session)}
            >
              {resolveBranchLabel(session)}
            </span>
            <span className="text-dim">
              started {fmtDate(session.started_at)}
            </span>
            <span className="inline-flex flex-wrap gap-3">
              <StatChip kind="cost" value={session.total_cost ?? undefined} />
              <StatChip kind="runtime" value={sessionDurationMs} />
              <StatChip
                kind="tokens"
                value={session.total_tokens ?? undefined}
              />
              <StatChip kind="read" value={trace.usage.read} />
              <StatChip kind="written" value={trace.usage.written} />
            </span>
          </div>
        )}

        {activityRuns.length > 0 ? (
          <div className="mx-7 my-5 overflow-hidden rounded-2xl border-[length:var(--border-width)] border-border-soft bg-surface bg-[image:var(--surface)]">
            <div
              className={cx(
                ROW,
                'border-b-[length:var(--border-width)] border-border bg-panel-2',
              )}
            >
              <div className={LABEL} />
              <div className="relative min-h-10 min-w-0 overflow-hidden">
                {zonePct > 0 && (
                  <span
                    className="absolute inset-y-0 left-0 inline-flex items-center justify-center border-r-[length:var(--border-width)] border-border text-base text-amber"
                    style={{ width: `${zonePct}%` }}
                  >
                    request
                  </span>
                )}
                {ticks.map((tick) => (
                  <span
                    key={`${tick.label}-${tick.pct}`}
                    className="absolute bottom-2 -translate-x-1/2 font-mono text-base whitespace-nowrap text-dim"
                    style={{ left: `${tick.pct}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {lanes.map((lane) => {
              const KindIcon = KIND_ICONS[lane.kind]
              const icon =
                lane.model === undefined ? null : modelIcon(lane.model)
              const queued = lane.activityRuns.filter((p) => !p.started_at)
              return (
                <div
                  key={lane.id}
                  className={cx(
                    ROW,
                    'border-b-[length:var(--border-width)] border-border-soft last:border-b-0',
                  )}
                >
                  <div className={LABEL}>
                    <span
                      className="inline-flex items-center gap-2 overflow-hidden text-[17px] font-bold text-ellipsis"
                      style={{ color: paletteColor(lane.color) }}
                    >
                      <KindIcon
                        className="flex-none opacity-85"
                        size={22}
                        strokeWidth={2}
                      />
                      {lane.label}
                    </span>
                    {lane.model !== undefined && (
                      <span
                        className={cx(
                          LANE_META,
                          'inline-flex items-center gap-2',
                        )}
                        title={lane.model}
                      >
                        {icon !== null && (
                          <img
                            className="size-4 flex-none object-contain"
                            src={icon}
                            alt=""
                          />
                        )}
                        {modelName(lane.model)}
                      </span>
                    )}
                    {lane.context !== undefined && (
                      <span
                        className="mt-0.5 flex max-w-48 flex-col gap-1"
                        title={`${NUM.format(lane.context.used)} / ${NUM.format(lane.context.window)} tokens used · ${NUM.format(lane.context.window - lane.context.used)} remaining`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-sm leading-normal tracking-[0.06em] text-faint uppercase">
                            Context
                          </span>
                          <span className="font-mono text-sm leading-normal text-dim">
                            {contextLabel(lane.context)}
                          </span>
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full border-[length:var(--border-width)] border-border-soft bg-bg/75">
                          <span
                            className="block h-full rounded-full transition-[width] duration-300 ease-[ease]"
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
                      <span key={line} className={LANE_META}>
                        {line}
                      </span>
                    ))}
                  </div>
                  <div className={TRACK}>
                    {zonePct > 0 && (
                      <span
                        className="absolute inset-y-0 border-l-[length:var(--border-width)] border-border"
                        style={{ left: `${zonePct}%` }}
                      />
                    )}
                    {ticks.map((tick) => (
                      <span
                        key={`grid-${tick.label}-${tick.pct}`}
                        className="absolute inset-y-0 border-l border-dashed border-dim/14"
                        style={{ left: `${tick.pct}%` }}
                      />
                    ))}
                    {lane.activityRuns
                      .filter(
                        (activityRun) => blockGeom(activityRun) !== undefined,
                      )
                      .map((activityRun) => {
                        const duration = blockDurationMs(activityRun)
                        const tone = BLOCK_TONES[activityRun.status ?? '']
                        const selected =
                          activityRun.activity_run_id === activityRunId
                        return (
                          <button
                            key={activityRun.activity_run_id}
                            type="button"
                            className={cx(
                              BLOCK,
                              tone ?? 'text-text',
                              selected ? BLOCK_SELECTED : BLOCK_HOVER,
                            )}
                            style={blockStyle(activityRun, lane)}
                            title={`${activityRun.name} — ${activityRun.status}${activityRun.description ? `\n${activityRun.description}` : ''}`}
                            onClick={() => selectActivityRun(activityRun)}
                          >
                            <span className="flex min-w-0 items-baseline gap-2.5">
                              <span
                                className={cx(
                                  'flex-none',
                                  STATUS_TONES[activityRun.status ?? ''],
                                )}
                              >
                                {STATUS_GLYPH[activityRun.status ?? ''] ??
                                  '\u25cb'}
                              </span>
                              <span className="truncate text-[17px] font-bold">
                                {activityRun.name}
                              </span>
                              {Number.isFinite(duration) && (
                                <StatChip
                                  kind="runtime"
                                  compact
                                  value={duration}
                                />
                              )}
                            </span>
                            <span className="min-w-0 truncate text-dim">
                              {activityRun.description}
                            </span>
                            {toolTickPositions(
                              activityRun,
                              marksByActivityRun.get(
                                activityRun.activity_run_id,
                              ) ?? [],
                              nowMs,
                            ).map((mark) => (
                              <span
                                key={mark.id}
                                className={cx(
                                  TOOL_TICK,
                                  mark.ok ? 'bg-current opacity-55' : 'bg-red',
                                )}
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
                        className={cx(
                          BLOCK,
                          'max-w-full min-w-44',
                          BLOCK_TONES.queued,
                          activityRun.activity_run_id === activityRunId
                            ? BLOCK_SELECTED
                            : BLOCK_HOVER,
                        )}
                        style={{ right: `${10 + index * 5}px` }}
                        title={`${activityRun.name} — queued`}
                        onClick={() => selectActivityRun(activityRun)}
                      >
                        <span className="flex min-w-0 items-baseline gap-2.5">
                          <span className="flex-none text-faint">
                            {'\u25cb'}
                          </span>
                          <span className="truncate text-[17px] font-bold">
                            {activityRun.name}
                          </span>
                        </span>
                        <span className="min-w-0 truncate text-dim">
                          queued
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : trace.loaded ? (
          <div className={EMPTY_STATE}>
            no activityRuns recorded for this session
          </div>
        ) : trace.error === undefined ? (
          <div className={EMPTY_STATE}>loading trace…</div>
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
                sendDecision={sendDecision}
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
