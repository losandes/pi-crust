/**
 * Mounts two real `SessionCard`s — one with a single watched workspace, one
 * with several — so `SessionCard.layout.test.ts` can measure actual rendered
 * geometry in a real browser. Not shipped; loaded only by that test's
 * in-memory Vite server.
 */
import { createRoot } from 'react-dom/client'
import type { SessionSummary } from '../../../shared/types'
import '../../style.css'
import { SessionCard } from '../SessionCard'

const now = Date.now()

const session: SessionSummary = {
  run_id: 'run-diag-1',
  lifecycle: 'plan + build',
  request: 'diagnose the card layout',
  status: 'success',
  engineer: 'someone',
  started_at: new Date(now - 60_000).toISOString(),
  ended_at: new Date(now).toISOString(),
  total_tokens: 12345,
  total_cost: 0.42,
  archived: 0,
  workspace_root: '/repo/a',
  branch: 'main',
  name: null,
  workspace: 'a',
  activityRuns: [
    {
      activity_run_id: 'ar1',
      run_id: 'run-diag-1',
      seq: 1,
      name: 'plan',
      kind: 'agent',
      owner: 'planner',
      description: null,
      status: 'success',
      error: null,
      started_at: new Date(now - 60_000).toISOString(),
      ended_at: new Date(now).toISOString(),
    },
  ],
  activity_run_count: 1,
  agents: [
    {
      run_id: 'run-diag-1',
      agent: 'planner',
      coding_agent: null,
      model: 'test-model',
      session_id: null,
      color: null,
      context_tokens: null,
      context_window: null,
      created_at: null,
      last_used_at: null,
    },
  ],
}

const mount = (id: string, workspaceRole: string | undefined) => {
  const el = document.getElementById(id)
  if (!el) return
  createRoot(el).render(
    <SessionCard
      session={session}
      nowMs={now}
      workspaceRole={workspaceRole}
      onArchived={() => {}}
      onRefused={() => {}}
    />,
  )
}

mount('single', undefined)
mount('multi', 'a')
