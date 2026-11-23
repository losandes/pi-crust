/**
 * Mounts real `SessionCard`s with one or several watched workspaces, plus
 * missing and long branches, so `SessionCard.layout.test.ts` measures rendered
 * geometry in a real browser. Not shipped; loaded only by that test's
 * in-memory Vite server.
 */

import type { SessionSummary } from '@shared/types'
import { createRoot } from 'react-dom/client'
import '@/style.css'
import { SessionCard } from '../SessionCard'

const now = Date.now()
const LONG_BRANCH = `feature/${'x'.repeat(112)}`

const session: SessionSummary = {
  run_id: 'run-diag-1',
  repository_root: '/repos/alpha',
  repository: 'alpha',
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

const mount = (
  id: string,
  workspaceRole: string,
  cardSession: Readonly<SessionSummary> = session,
) => {
  const el = document.getElementById(id)
  if (!el) return
  createRoot(el).render(
    <SessionCard
      session={cardSession}
      nowMs={now}
      workspaceRole={workspaceRole}
      onArchived={() => {}}
      onRefused={() => {}}
    />,
  )
}

mount('single', 'blue')
mount('multi', 'amber')
mount('unrecorded', 'blue', {
  ...session,
  branch: null,
  workspace: 'pi-crust',
  repository_root: undefined,
  repository: undefined,
})
mount('long', 'blue', { ...session, branch: LONG_BRANCH })
