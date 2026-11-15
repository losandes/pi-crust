import { createRoot } from 'react-dom/client'
import '@fontsource/play/400.css'
import '@fontsource/play/700.css'
import '@/style.css'
import DefaultLayout from '@/layouts/default-layout'
import highContrastCss from '../../../../../../../../templates/stamp/config/high-contrast.css?raw'
import { SessionsList } from '../SessionsList'

const now = Date.now()
const startedAt = new Date(now - 60_000).toISOString()
const endedAt = new Date(now).toISOString()
const sessions = [
  {
    run_id: 'dashboard-success',
    status: 'success',
    workspace: 'alpha',
    branch: 'main',
    owners: [
      'planner',
      'builder',
      'reviewer',
      'documenter',
      'tester',
      'auditor',
    ],
  },
  {
    run_id: 'dashboard-fail',
    status: 'fail',
    workspace: 'beta',
    branch: 'feature/dashboard',
    owners: ['planner', 'builder', 'reviewer', 'documenter'],
  },
  {
    run_id: 'dashboard-running',
    status: 'running',
    workspace: 'alpha',
    branch: 'main',
    owners: ['builder'],
  },
  {
    run_id: 'dashboard-waiting',
    status: 'waiting',
    workspace: 'beta',
    branch: 'feature/dashboard',
    owners: [],
  },
].map(({ owners, ...session }) => ({
  ...session,
  lifecycle: session.status === 'fail' ? 'build' : 'plan + build',
  name: '',
  request: 'Keep the dashboard readable on a phone without clipping its stats',
  engineer: 'fixture',
  started_at: startedAt,
  ended_at: endedAt,
  total_tokens: 12345,
  total_cost: 0.42,
  archived: 0,
  workspace_root: `/fixture/${session.workspace}`,
  activityRuns: owners.map((owner, index) => ({
    activity_run_id: `${session.run_id}-${owner}`,
    run_id: session.run_id,
    seq: index + 1,
    name: owner,
    kind: 'agent',
    owner,
    description: 'Dashboard layout fixture',
    status: ['success', 'fail', 'running', 'queued'][index % 4],
    error: '',
    started_at: startedAt,
    ended_at: endedAt,
  })),
  activity_run_count: owners.length,
  agents: [],
}))

const themes = [
  { name: 'auto', label: 'Auto', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
  {
    name: 'high-contrast',
    label: 'High contrast',
    builtin: false,
    css: highContrastCss,
  },
]

const events = [
  {
    rowid: 1,
    event_id: 'dashboard-tool-call',
    run_id: 'dashboard-running',
    activity_run_id: 'dashboard-running-builder',
    parent_id: '',
    type: 'tool_call',
    name: 'read',
    payload_json: '{"tool":"read"}',
    tokens: 0,
    started_at: new Date(now - 30_000).toISOString(),
    ended_at: endedAt,
  },
]

// This browser-only I/O adapter serves literal fixtures, never the observe API.
// biome-ignore lint/plugin/no-object-mutation: window.fetch is the external API being adapted at this test harness's boundary.
window.fetch = new Proxy(window.fetch, {
  apply: (_fetch, _context, [input]) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    )
    const body =
      url.pathname === '/api/sessions'
        ? sessions
        : url.pathname === '/api/themes'
          ? { themes }
          : {
              events:
                url.pathname === '/api/sessions/dashboard-running/events' &&
                url.searchParams.get('after') === '0'
                  ? events
                  : [],
              cursor: 1,
              has_more: false,
            }
    return Promise.resolve(Response.json(body))
  },
})

const app = document.getElementById('app')
if (app) {
  createRoot(app).render(
    <DefaultLayout>
      <SessionsList />
    </DefaultLayout>,
  )
}
