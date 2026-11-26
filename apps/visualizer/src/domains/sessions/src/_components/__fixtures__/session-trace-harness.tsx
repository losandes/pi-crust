import { createRoot } from 'react-dom/client'
import '@fontsource/play/400.css'
import '@fontsource/play/700.css'
import '@/style.css'
import DefaultLayout from '@/layouts/default-layout'
import { useRoute } from '@/lib/router'
import { SessionTrace } from '../../..'

const now = Date.now()
const LONG_BRANCH = `feature/${'x'.repeat(112)}`
const at = (seconds: number) => new Date(now + seconds * 1000).toISOString()
const query = new URLSearchParams(window.location.search)
const overflow = query.has('overflow')
const longId = 'unbroken-identifier-'.repeat(30)
const longPath = `src/${'long-directory/'.repeat(30)}activity.tsx`
const runId = overflow ? `trace-layout-${longId}` : 'trace-layout'
const status = query.get('status') ?? 'waiting'
const state = query.get('state') ?? 'populated'
const session = {
  run_id: runId,
  lifecycle: 'build',
  request: overflow
    ? longId
    : 'Keep the trace readable on a phone, including a request that is longer than its character measure permits on one line',
  status,
  engineer: 'fixture engineer',
  started_at: at(-60),
  ended_at: status === 'running' ? '' : at(0),
  total_tokens: 12345,
  total_cost: 0.42,
  archived: 0,
  workspace_root: overflow ? `/fixture/${longPath}` : '/fixture/trace',
  branch:
    query.get('branch') === 'none'
      ? null
      : query.get('branch') === 'long'
        ? LONG_BRANCH
        : overflow
          ? longId
          : 'feature/trace-layout',
  name: '',
  workspace: 'fixture',
}

const activityRuns = [
  {
    id: 'request',
    kind: 'engineer',
    owner: '',
    status: 'success',
    start: -60,
    end: -58,
  },
  {
    id: 'prepare',
    kind: 'code',
    owner: '',
    status: 'success',
    start: -58,
    end: -55,
  },
  {
    id: 'plan',
    kind: 'agent',
    owner: 'planner',
    status: 'success',
    start: -55,
    end: -40,
  },
  {
    id: 'retry',
    kind: 'agent',
    owner: 'builder',
    status: 'fail',
    start: -40,
    end: -25,
  },
  {
    id: 'build',
    kind: 'agent',
    owner: 'builder',
    status: 'running',
    start: -25,
    end: 0,
  },
  {
    id: 'review',
    kind: 'agent',
    owner: 'reviewer',
    status: 'queued',
    start: undefined,
    end: undefined,
  },
].map(({ id, start, end, ...activity }, index) => ({
  ...activity,
  activity_run_id: id,
  run_id: session.run_id,
  seq: index + 1,
  name: id,
  description: `The ${id} activity in the trace layout fixture`,
  error: '',
  started_at: start === undefined ? '' : at(start),
  ended_at: end === undefined ? '' : at(end),
}))

const agents = ['planner', 'builder', 'reviewer'].map((agent) => ({
  run_id: session.run_id,
  agent,
  coding_agent: 'pi',
  model: 'claude-sonnet-4-6',
  session_id: `fixture-${agent}`,
  color: agent === 'planner' ? 'purple' : 'blue',
  context_tokens: 50000,
  context_window: 200000,
  created_at: at(-60),
  last_used_at: at(0),
}))

const events = [
  {
    type: 'log',
    name: 'developer_note',
    payload: {
      note: 'Keep the request, notices and waterfall readable together on a small phone.',
      from: 'fixture developer',
      at: at(-60),
    },
    activity: '',
    time: -60,
  },
  {
    type: 'log',
    name: 'branched_from',
    payload: { from_run_id: 'original-run', activity: 'plan', at: at(-59) },
    activity: '',
    time: -59,
  },
  {
    type: 'steer',
    name: 'branch build',
    payload: {
      target: 'branch',
      branch_run_id: 'follow-up-run',
      activity: 'build',
      at: at(-20),
    },
    activity: '',
    time: -20,
  },
  {
    type: 'tool_call',
    name: overflow ? `read: ${longPath}` : 'read',
    payload: {
      tool: 'read',
      ok: true,
      ...(overflow ? { args: { path: longPath } } : {}),
    },
    activity: 'build',
    time: -15,
  },
  {
    type: 'tool_call',
    name: 'bash',
    payload: { tool: 'bash', ok: false },
    activity: 'build',
    time: -10,
  },
  ...(overflow
    ? [
        {
          type: 'agent_start',
          name: 'builder',
          payload: {
            coding_agent: 'pi',
            model: 'claude-sonnet-4-6',
            thinking: 'high',
            tools: ['read', 'edit', 'bash'],
            session_id: longId,
          },
          activity: 'build',
          time: -24,
        },
        {
          type: 'narration',
          name: 'builder',
          payload: { text: `Inspecting ${longPath}` },
          activity: 'build',
          time: -14,
        },
      ]
    : []),
  {
    type: 'log',
    name: 'tree_warning',
    payload: {
      kind: 'unexpected',
      activities: ['build'],
      activity_run_ids: ['build'],
      stage: 'build',
      paths: ['src/fixture.ts'],
      note: 'A fixture warning keeps the real standalone report in the page.',
    },
    activity: '',
    time: -5,
  },
].map(({ payload, activity, time, ...event }, index) => ({
  ...event,
  rowid: index + 1,
  event_id: `trace-event-${index}`,
  run_id: session.run_id,
  activity_run_id: activity,
  parent_id: '',
  payload_json: JSON.stringify(payload),
  tokens: 0,
  started_at: at(time),
  ended_at: at(time),
}))

const themes = [
  { name: 'auto', label: 'Auto', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  {
    name: 'high-contrast',
    label: 'High contrast',
    builtin: true,
    css: '',
  },
]

// This browser-only boundary serves literal fixtures, never the observe API.
// biome-ignore lint/plugin/no-object-mutation: window.fetch is the external API adapted by this isolated browser harness.
window.fetch = new Proxy(window.fetch, {
  apply: (_fetch, _context, [input]) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    )
    if (url.pathname === `/api/sessions/${runId}`) {
      if (state === 'loading') return new Promise<Response>(() => {})
      if (state === 'error') {
        return Promise.resolve(
          Response.json({ error: 'fixture unavailable' }, { status: 503 }),
        )
      }
    }
    const body =
      url.pathname === '/api/themes'
        ? { themes }
        : url.pathname === `/api/sessions/${runId}`
          ? {
              session,
              activityRuns: state === 'empty' ? [] : activityRuns,
              agents,
              usage: { read: 10000, written: 2345 },
              handoff_dir: '',
            }
          : overflow && url.pathname.endsWith('/envelopes')
            ? [
                {
                  envelope_id: 'overflow-envelope',
                  run_id: runId,
                  activity_run_id: 'build',
                  agent: 'builder',
                  output_type: 'BuildOutput',
                  valid: 1,
                  payload_json: JSON.stringify({
                    summary: longPath,
                    facts: [{ fact: longId, evidence: longPath }],
                    decisions: [{ decision: longId, rationale: longPath }],
                    assumptions: [
                      { assumption: longId, invalidated_by: longPath },
                    ],
                    unresolved: [
                      {
                        question: longId,
                        consequential: true,
                        beyond_this_run: false,
                        provisional_answer: longPath,
                      },
                    ],
                    risks: [],
                  }),
                  created_at: at(0),
                },
              ]
            : url.pathname.endsWith('/events')
              ? {
                  events: url.searchParams.get('after') === '0' ? events : [],
                  cursor: events.length,
                  has_more: false,
                }
              : url.pathname.endsWith('/decision-request')
                ? {
                    present: true,
                    markdown:
                      '# Waiting for you\n\nShould this trace layout be kept?',
                  }
                : []
    return Promise.resolve(Response.json(body))
  },
})

const TraceHarness = () => {
  const route = useRoute()
  return (
    <DefaultLayout>
      <SessionTrace
        runId={session.run_id}
        workspace="fixture"
        activityRunId={route.activityRunId}
      />
    </DefaultLayout>
  )
}

const app = document.getElementById('app')
if (app) createRoot(app).render(<TraceHarness />)
