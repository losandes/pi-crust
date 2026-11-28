import { expect, type Mock, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import type { EventRow } from '@/domains/events'
import type { SessionSummary } from '../typedefs/session'
import { createSessionCard } from './SessionCard'

const Dots: Parameters<typeof createSessionCard>[0]['ActivityRunDots'] = ({
  activityRuns,
}) => <span>{activityRuns.length} activities</span>

const NOW = Date.parse('2026-11-26T00:02:00Z')
const at = (offset: number) => new Date(NOW + offset).toISOString()
const fixture = (): SessionSummary => ({
  run_id: 'run',
  workspace: 'one',
  repository: 'app',
  repository_root: '/srv/private/app',
  workspace_root: '/srv/private/tree',
  repository_location: '…/private/app',
  workspace_location: '…/private/tree',
  branch: 'feature',
  name: 'build',
  lifecycle: 'sdlc',
  request: 'do work',
  status: 'running',
  started_at: at(-10000),
  ended_at: at(0),
  total_cost: 1,
  total_tokens: 100,
  archived: 0,
  engineer: 'tester',
  activity_run_count: 5,
  activityRuns: Array.from({ length: 5 }, (_, i) => ({
    activity_run_id: `a${i}`,
    run_id: 'run',
    kind: 'agent',
    owner: `agent${i}`,
    name: 'build',
    seq: i,
    description: '',
    error: '',
    status: 'running',
    started_at: at(-10000),
    ended_at: at(0),
  })),
  agents: [
    {
      run_id: 'run',
      agent: 'agent0',
      model: 'test-model',
      coding_agent: 'pi',
      session_id: 's',
      color: '#00aaff',
      context_tokens: 0,
      context_window: 0,
      created_at: at(0),
      last_used_at: at(0),
    },
  ],
})
const event = (
  id: string,
  offset: number,
  patch: Partial<EventRow> = {},
): EventRow => ({
  rowid: 1,
  event_id: id,
  run_id: 'run',
  activity_run_id: 'a0',
  parent_id: '',
  type: 'tool_call',
  name: 'read x',
  payload_json: '{}',
  tokens: 0,
  started_at: at(offset),
  ended_at: at(offset),
  ...patch,
})
const withCard = async (
  session: SessionSummary,
  events: readonly EventRow[],
  refused: boolean,
  check: (
    container: HTMLDivElement,
    archived: Mock<(id: string) => void>,
    problems: Mock<(problem: string) => void>,
  ) => Promise<void> | void,
) => {
  GlobalRegistrator.register()
  const archived = mock((_id: string) => {})
  const problems = mock((_problem: string) => {})
  const Component = createSessionCard({
    ActivityRunDots: Dots,
    useCardEvents: (runId, running, workspace) => {
      expect([runId, running, workspace]).toEqual([
        'run',
        session.status === 'running',
        'one',
      ])
      return events
    },
    archiveSession: (runId, value, workspace) => {
      expect([runId, value, workspace]).toEqual(['run', true, 'one'])
      return Promise.resolve(
        refused
          ? { ok: false, problem: 'token refused' }
          : { ok: true, data: {} },
      )
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const props: ComponentProps<ReturnType<typeof createSessionCard>> = {
    session,
    nowMs: NOW,
    workspaceRole: 'blue',
    onArchived: archived,
    onRefused: problems,
  }
  try {
    await act(() => root.render(<Component {...props} />))
    await check(container, archived, problems)
  } finally {
    await act(() => root.unmount())
    container.remove()
    await GlobalRegistrator.unregister()
  }
}

test(
  [
    'given a running card with display locations and timeline events',
    'when rendering and archiving',
    'it should show safe titles and delegate the original run address',
  ].join(', '),
  async () => {
    // given
    const session = fixture()
    const events = [
      event('early', -9000),
      event('latest', -1000),
      event('bad', 0, { started_at: 'bad' }),
      event('unknown', 0, { activity_run_id: 'unknown' }),
      event('no-owner', 0, { activity_run_id: '' }),
      event('ignored', 0, { type: 'narration' }),
    ]
    // when
    await withCard(
      session,
      events,
      false,
      async (container, archived, problems) => {
        // then
        expect(
          container
            .querySelector('[data-testid=session-repository]')
            ?.getAttribute('title'),
        ).toBe(session.repository_location)
        expect(
          container
            .querySelector('[data-testid=session-branch]')
            ?.getAttribute('title'),
        ).toBe(session.workspace_location)
        expect(container.innerHTML).not.toContain(session.repository_root ?? '')
        expect(container.innerHTML).not.toContain(session.workspace_root ?? '')
        expect(container.textContent).toContain('+2 more agents')
        expect(
          container.querySelector('[title="agent0 test-model"]'),
        ).not.toBeNull()
        expect(container.querySelectorAll('[title^="tool_call"]')).toHaveLength(
          2,
        )
        // when
        await act(() => container.querySelector('button')?.click())
        // then
        expect(archived.mock.calls.flat()).toEqual(['run'])
        expect(problems.mock.calls.flat()).toEqual([])
      },
    )
  },
)

test(
  [
    'given an unrecorded card without agent runs',
    'when an archive is refused',
    'it should use safe fallbacks and restore the card with the reason',
  ].join(', '),
  async () => {
    // given
    const session = {
      ...fixture(),
      repository_location: undefined,
      workspace_location: undefined,
      status: 'fail' as const,
      activityRuns: [],
      agents: [],
      started_at: '',
      ended_at: '',
      name: '',
      lifecycle: '',
      total_cost: 0,
      total_tokens: 0,
    }
    // when
    await withCard(session, [], true, async (container, archived, problems) => {
      // then
      expect(
        container
          .querySelector('[data-testid=session-repository]')
          ?.getAttribute('title'),
      ).toBe('repository not recorded')
      expect(
        container
          .querySelector('[data-testid=session-branch]')
          ?.getAttribute('title'),
      ).toBe('one')
      expect(container.textContent).toContain('no agent activity yet')
      // when
      await act(() => container.querySelector('button')?.click())
      // then
      expect(archived.mock.calls.flat()).toEqual(['run', ''])
      expect(problems.mock.calls.flat()).toEqual(['token refused'])
    })
  },
)

test(
  [
    'given a finished card with event-derived bounds',
    'when rendering a small roster',
    'it should draw non-live dots and fall back to event times',
  ].join(', '),
  async () => {
    // given
    const source = fixture()
    const session = {
      ...source,
      status: 'success' as const,
      started_at: '',
      ended_at: '',
      activityRuns: [
        ...source.activityRuns.slice(0, 1),
        {
          ...source.activityRuns[0],
          activity_run_id: 'duplicate',
          kind: 'agent' as const,
          owner: 'agent0',
        },
        { ...source.activityRuns[0], kind: 'code' as const, owner: '' },
      ],
    } as SessionSummary
    // when
    await withCard(session, [event('one', -1000)], false, (container) => {
      // then
      expect(container.querySelectorAll('[title^="tool_call"]')).toHaveLength(1)
      expect(container.textContent).not.toContain('more agents')
    })
  },
)

test(
  [
    'given a card without valid dates or events',
    'when rendering its agent row',
    'it should use the current time and a minimum span',
  ].join(', '),
  async () => {
    // given
    const source = fixture()
    const session = {
      ...source,
      status: 'success' as const,
      started_at: '',
      ended_at: '',
      activityRuns: source.activityRuns.slice(0, 1),
      agents: [],
    }
    // when
    await withCard(session, [], false, (container) => {
      // then
      expect(container.textContent).toContain('agent0')
      expect(container.querySelectorAll('[title^="tool_call"]')).toHaveLength(0)
    })
  },
)
