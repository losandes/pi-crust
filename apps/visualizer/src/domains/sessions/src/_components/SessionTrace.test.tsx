import { expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ActivityRun } from '@/domains/activity-runs'
import type { EventRow } from '@/domains/events'
import type { SessionStatus } from '../typedefs/session'
import type { TTrace } from '../usecases/use-trace'
import { createSessionTrace } from './SessionTrace'

const Detail = ({ onClose }: Readonly<{ onClose: () => void }>) => (
  <button type="button" onClick={onClose}>
    selected detail
  </button>
)
const Decision = () => <div>decision</div>
const Context = () => <div>session context</div>
const Warnings = () => <div>tree warnings</div>
const NOW = Date.parse('2026-11-26T00:02:00Z')
const at = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()
const activity = (
  name: string,
  kind: ActivityRun['kind'],
  status: ActivityRun['status'],
  start: number,
  end: number,
): ActivityRun => ({
  activity_run_id: name,
  run_id: 'run',
  seq: 1,
  name,
  kind,
  owner: kind === 'agent' ? 'builder' : 'pi-crust',
  description: `${name} description`,
  status,
  error: '',
  started_at: at(start),
  ended_at: at(end),
})
const taskEvent = (
  rowid: number,
  name: string,
  task: string,
  start: number,
  end: number,
  owner: string,
): EventRow => ({
  rowid,
  event_id: `e${rowid}`,
  run_id: 'run',
  activity_run_id: owner,
  parent_id: '',
  type: 'log',
  name,
  payload_json: JSON.stringify({
    task,
    execution: task,
    moment: 'change',
    passed: false,
  }),
  tokens: 0,
  started_at: at(start),
  ended_at: at(end),
})
const fixture = (status: SessionStatus = 'running'): TTrace => ({
  session: {
    run_id: 'run',
    lifecycle: 'build',
    request: 'a request',
    status,
    engineer: 'tester',
    started_at: at(100),
    ended_at: at(0),
    total_tokens: 100,
    total_cost: 0.1,
    archived: 0,
    workspace_root: '/fixture',
    repository_root: '/fixture',
    branch: 'work',
    name: 'fixture',
    workspace: 'main',
  },
  activityRuns: [
    activity('request', 'engineer', 'success', 100, 90),
    activity('prepare', 'code', 'success', 89, 85),
    activity('retry', 'agent', 'fail', 40, 25),
    activity('build', 'agent', 'running', 25, 0),
  ],
  events: [
    taskEvent(1, 'task_start', 'test', 27, 26, 'retry'),
    taskEvent(2, 'task_end', 'test', 27, 26, 'retry'),
    taskEvent(3, 'task_start', 'lint', 3, 0, 'build'),
  ],
  agents: [],
  usage: { read: 0, written: 0 },
  handoffDir: undefined,
  envelopes: [],
  gates: [],
  nowMs: NOW,
  loaded: true,
  error: undefined,
})

const withTrace = async (
  trace: TTrace,
  check: (container: HTMLDivElement) => Promise<void> | void,
  selected?: string,
) => {
  GlobalRegistrator.register()
  const Component = createSessionTrace({
    useTrace: () => trace,
    ActivityRunDetail: Detail,
    DecisionRequest: Decision,
    SessionContext: Context,
    TreeWarnings: Warnings,
    warningsIn: () => [],
    sendDecision: async () => ({
      ok: false,
      problem: 'not used by this fixture',
    }),
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(() =>
      root.render(
        <Component
          runId="run"
          activityRunId={selected}
          workspace={undefined}
        />,
      ),
    )
    await check(container)
  } finally {
    await act(() => root.unmount())
    container.remove()
    await GlobalRegistrator.unregister()
  }
}
for (const location of ['…/fixture', undefined]) {
  test(
    [
      `given a trace with repository location ${location}`,
      'when rendering its header',
      'it should use only the safe display tooltip',
    ].join(', '),
    async () => {
      // given
      const trace = fixture()
      const input = {
        ...trace,
        session: trace.session
          ? { ...trace.session, repository_location: location }
          : undefined,
      }
      // when
      await withTrace(input, (container) => {
        // then
        expect(
          container
            .querySelector('[data-testid=session-repository]')
            ?.getAttribute('title'),
        ).toBe(location ?? 'repository not recorded')
      })
    },
  )
}

const codeButtons = (container: HTMLDivElement) => {
  const label = [...container.querySelectorAll('span')].find(
    (span) => span.textContent === 'code',
  )
  const row = label?.parentElement?.parentElement
  expect(row).toBeDefined()
  return [...(row?.querySelectorAll('button') ?? [])]
}

for (const status of ['running', 'success'] as const) {
  test(
    [
      `given repository task events in a ${status} session`,
      'when displaying the code row',
      'it should retain import and failed tasks and show only live tasks as running',
    ].join(', '),
    async () => {
      // given
      const trace = fixture(status)
      // when
      await withTrace(trace, async (container) => {
        const buttons = codeButtons(container)
        // then
        expect(
          buttons.some((button) =>
            button.title.startsWith('prepare — success'),
          ),
        ).toBe(true)
        expect(
          buttons.some((button) => button.title.startsWith('test — fail')),
        ).toBe(true)
        expect(
          buttons.some((button) => button.title.startsWith('lint — running')),
        ).toBe(status === 'running')
        const failed = buttons.find((button) =>
          button.title.startsWith('test — fail'),
        )
        expect(failed?.textContent).toContain('1.0s')
        // when
        await act(() => failed?.click())
        // then
        expect(location.hash.endsWith('/retry')).toBe(true)
      })
    },
  )
}

test(
  [
    'given a trace with no task executions',
    'when displaying the code row',
    'it should show only the existing prepare block',
  ].join(', '),
  async () => {
    // given
    const trace = { ...fixture(), events: [] }
    // when
    await withTrace(trace, (container) => {
      // then
      expect(codeButtons(container).map((button) => button.title)).toEqual([
        'prepare — success\nprepare description',
      ])
    })
  },
)

test(
  [
    'given a task whose Activity Run is not in the trace',
    'when clicking its code block',
    'it should not navigate',
  ].join(', '),
  async () => {
    // given
    const trace = fixture()
    const orphan = {
      ...trace,
      events: trace.events.map((event) => ({
        ...event,
        activity_run_id: 'unknown',
      })),
    }
    // when
    await withTrace(orphan, async (container) => {
      const hash = location.hash
      await act(() =>
        codeButtons(container)
          .find((button) => button.title.startsWith('test — fail'))
          ?.click(),
      )
      // then
      expect(location.hash).toBe(hash)
    })
  },
)

test(
  [
    'given a selected Activity Run and its task',
    'when clicking the same task',
    'it should clear the Activity Run selection',
  ].join(', '),
  async () => {
    // given
    const trace = fixture()
    // when
    await withTrace(
      trace,
      async (container) => {
        expect(container.textContent).toContain('selected detail')
        await act(() =>
          [...container.querySelectorAll('button')]
            .find((button) => button.textContent === 'selected detail')
            ?.click(),
        )
        expect(location.hash.endsWith('/retry')).toBe(false)
        await act(() =>
          codeButtons(container)
            .find((button) => button.title.startsWith('test — fail'))
            ?.click(),
        )
        // then
        expect(location.hash.endsWith('/retry')).toBe(false)
      },
      'retry',
    )
  },
)

test(
  [
    'given agent metadata, tool spans and a queued Activity Run',
    'when rendering and selecting the queued block',
    'it should show context and model metadata and navigate to that Activity Run',
  ].join(', '),
  async () => {
    // given
    const base = fixture()
    const trace: TTrace = {
      ...base,
      activityRuns: [
        ...base.activityRuns,
        {
          ...activity('queued', 'agent', 'queued', 0, 0),
          started_at: '',
          ended_at: '',
        },
      ],
      agents: [
        {
          run_id: 'run',
          agent: 'builder',
          coding_agent: 'pi',
          model: 'anthropic/claude-sonnet-4-6',
          session_id: 'session',
          color: 'blue',
          context_tokens: 1000,
          context_window: 200000,
          created_at: at(40),
          last_used_at: at(1),
        },
      ],
      events: [
        ...base.events,
        {
          ...taskEvent(4, 'builder', 'unused', 40, 39, 'build'),
          type: 'agent_start',
          payload_json: JSON.stringify({
            model: 'anthropic/claude-sonnet-4-6',
            color: 'blue',
          }),
        },
        {
          ...taskEvent(5, 'builder', 'unused', 39, 38, 'build'),
          type: 'agent_start',
          payload_json: '{}',
        },
        {
          ...taskEvent(6, 'read', 'unused', 20, 19, 'build'),
          type: 'tool_call',
          payload_json: '{"ok":true}',
        },
      ],
    }
    // when
    await withTrace(trace, async (container) => {
      // then
      expect(container.textContent).toContain('Context')
      expect(container.textContent).toContain('queued')
      // when
      await act(() =>
        container
          .querySelector<HTMLButtonElement>('button[title="queued — queued"]')
          ?.click(),
      )
      // then
      expect(location.hash.endsWith('/queued')).toBe(true)
    })
  },
)

test(
  [
    'given a run with a developer note and branch history',
    'when displaying the standalone trace',
    'it should preserve the note and links to both related runs',
  ].join(', '),
  async () => {
    // given
    const base = fixture()
    const trace: TTrace = {
      ...base,
      events: [
        ...base.events,
        {
          ...taskEvent(4, 'developer_note', '', 60, 60, ''),
          payload_json: JSON.stringify({
            note: 'keep task details',
            from: 'operator',
          }),
        },
        {
          ...taskEvent(5, 'branched_from', '', 59, 59, ''),
          payload_json: JSON.stringify({
            from_run_id: 'original',
            activity: 'build',
          }),
        },
        {
          ...taskEvent(6, 'branch build', '', 58, 58, ''),
          type: 'steer',
          payload_json: JSON.stringify({
            target: 'branch',
            branch_run_id: 'follow-up',
            activity: 'build',
          }),
        },
      ],
    }
    // when
    await withTrace(trace, (container) => {
      // then
      expect(container.textContent).toContain('operator')
      expect(container.textContent).toContain('keep task details')
      expect(container.textContent).toContain('branched from')
      expect(container.textContent).toContain('branched to')
      expect(
        [...container.querySelectorAll('a')].map((link) => link.textContent),
      ).toEqual(['original', 'follow-up'])
      expect(container.textContent).toContain('tree warnings')
    })
  },
)

for (const state of ['empty', 'loading', 'error'] as const) {
  test(
    [
      `given an ${state} trace`,
      'when rendering the chart',
      'it should display the corresponding state',
    ].join(', '),
    async () => {
      // given
      const trace: TTrace = {
        ...fixture(),
        session: undefined,
        activityRuns: [],
        events: [],
        loaded: state === 'empty',
        error: state === 'error' ? 'offline' : undefined,
      }
      // when
      await withTrace(trace, (container) => {
        // then
        expect(container.textContent).toContain(
          state === 'empty'
            ? 'no activityRuns'
            : state === 'loading'
              ? 'loading trace'
              : 'offline',
        )
      })
    },
  )
}
