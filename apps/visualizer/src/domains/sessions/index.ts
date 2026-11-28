import {
  ActivityRunDetail,
  ActivityRunDots,
  TreeWarnings,
  warningsIn,
} from '@/domains/activity-runs'
import { DecisionRequest, sendDecision } from '@/domains/decisions'
import { SessionContext } from '@/domains/handoff'
import { createSessionCard } from './src/_components/SessionCard'
import { createSessionsList } from './src/_components/SessionsList'
import { createSessionTrace } from './src/_components/SessionTrace'
import { fetchSessions } from './src/io/fetch-sessions'
import { archiveSession } from './src/io/send-archive-session'
import { useCardEvents } from './src/usecases/use-card-events'
import { useTrace } from './src/usecases/use-trace'

export { FilterDropdown } from './src/_components/FilterDropdown'
export { RunNotices } from './src/_components/RunNotices'
export const SessionCard = createSessionCard({
  useCardEvents,
  archiveSession,
  ActivityRunDots,
})
export const SessionsList = createSessionsList({ fetchSessions, SessionCard })
export const SessionTrace = createSessionTrace({
  useTrace,
  ActivityRunDetail,
  DecisionRequest,
  SessionContext,
  TreeWarnings,
  warningsIn,
  sendDecision,
})
export { fetchHealth } from './src/io/fetch-health'
export { fetchSession } from './src/io/fetch-session'
export { fetchWorkspaces } from './src/io/fetch-workspaces'
export {
  FILTER_STORAGE_KEY,
  readFilters,
  saveFilters,
} from './src/state/filters-store'
export type { TFilterKey, TFilters } from './src/typedefs/filters'
export {
  ARCHIVED_OPTIONS,
  DEFAULT_FILTERS,
  FILTER_KEYS,
  FILTER_LABELS,
  STATUS_ORDER,
} from './src/typedefs/filters'
export type {
  HealthResponse,
  Session,
  SessionDetail,
  SessionStatus,
  SessionSummary,
  SessionUsage,
  WorkspaceInfo,
} from './src/typedefs/session'
export {
  cleared,
  isOptimisticallyHidden,
  matchesFilters,
  matchingOptions,
  needsArchived,
  optionsFor,
  toggled,
  valueOf,
} from './src/usecases/filters'
export type { TRunNotice } from './src/usecases/notices'
export { runNoticesOf } from './src/usecases/notices'
export type { TTrace } from './src/usecases/use-trace'
export { useTrace } from './src/usecases/use-trace'
export type { TLaneContext } from './src/usecases/waterfall'
export {
  blockLayout,
  contextFill,
  contextLabel,
  laneContext,
  originMs,
  REQ_ZONE_PCT,
  timeRange,
  toolTickPositions,
} from './src/usecases/waterfall'
export { archiveSession, fetchSessions }
