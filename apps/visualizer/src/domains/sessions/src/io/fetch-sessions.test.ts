import { expect, mock, test } from 'bun:test'
import type { ActivityRun } from '@shared/types'
import { createFetchEvents } from '@/domains/events'
import {
  createRedactionStore,
  type TRunAddress,
  type TRunRoots,
} from '@/lib/redaction'
import { createFetchSessions } from './fetch-sessions'

const activityRun = {
  activity_run_id: 'build',
  run_id: 'same',
  seq: 1,
  name: 'build',
  kind: 'agent',
  status: 'fail',
  started_at: '2026-01-01T00:00:00Z',
  ended_at: '2026-01-01T00:00:00Z',
  error: '/Users/ada/x',
  description: '/Users/ada/wt/one/x',
  owner: 'builder',
} satisfies ActivityRun

const rows = [
  {
    run_id: 'same',
    workspace: 'one',
    repository_root: '/Users/ada/a/app',
    workspace_root: '/Users/ada/wt/one',
    request: '/Users/ada/a/app/x',
    name: '/Users/ada/x',
    status: 'success',
    activityRuns: [activityRun],
  },
  {
    run_id: 'same',
    workspace: 'two',
    repository_root: '/Users/ada/b/app',
    workspace_root: '',
    activityRuns: [],
  },
  {
    run_id: 'old',
    workspace: 'one',
    repository_root: null,
    workspace_root: null,
    activityRuns: [],
  },
  { run_id: 'missing', workspace: 'one', activityRuns: [] },
]
for (const enabled of [true, false]) {
  test(
    [
      `given sessions with redaction ${enabled}`,
      'when fetching summaries',
      'it should retain root identities and add distinct display locations',
    ].join(', '),
    async () => {
      // given
      const store = createRedactionStore({
        fetchHealth: async () => ({
          redact_paths: enabled,
          home_dir: '/Users/ada',
        }),
      })
      const remembered = mock((address: TRunAddress, roots: TRunRoots) =>
        store.remember(address, roots),
      )
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(Response.json(rows))

      // when
      const actual = await createFetchSessions(
        {
          ...store,
          remember: remembered,
        },
        request,
      )('one', true)
      // then
      expect(request).toHaveBeenCalledWith(
        '/api/sessions?workspace=one&include_archived=1',
      )
      // The wire fixtures deliberately include legacy null and absent roots.
      expect(rows.map((row) => row.repository_root)).toEqual(
        actual.map((row) => row.repository_root),
      )
      expect(rows.map((row) => row.workspace_root)).toEqual(
        actual.map((row) => row.workspace_root),
      )
      expect(actual[0]).toMatchObject({
        request: enabled ? '<repo>/x' : rows[0]?.request,
        name: enabled ? '~/x' : rows[0]?.name,
        status: 'success',
        repository_location: enabled ? '~/a/app' : rows[0]?.repository_root,
        workspace_location: enabled ? '~/wt/one' : rows[0]?.workspace_root,
      })
      expect(actual[0]?.activityRuns).toEqual([
        {
          ...activityRun,
          error: enabled ? '~/x' : activityRun.error,
          description: enabled ? '<worktree>/x' : activityRun.description,
        },
      ])
      expect(actual[1]?.repository_location).not.toBe(
        actual[0]?.repository_location,
      )
      expect(actual[2]?.repository_location).toBeUndefined()
      expect(actual[3]?.workspace_location).toBeUndefined()
      expect(remembered.mock.calls).toEqual(
        rows.map((row) => [
          { runId: row.run_id, workspace: row.workspace },
          {
            repository_root: row.repository_root,
            workspace_root: row.workspace_root,
          },
        ]),
      )
    },
  )
}

test(
  [
    'given the same run id in two workspaces',
    'when fetching sessions then events',
    'it should use each workspace roots and refuse an unqualified read',
  ].join(', '),
  async () => {
    // given
    const store = createRedactionStore({
      fetchHealth: async () => ({ home_dir: '/Users/ada' }),
    })
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(
      Response.json([
        {
          run_id: 'same',
          workspace: 'one',
          repository_root: '/srv/one/app',
          activityRuns: [],
        },
        {
          run_id: 'same',
          workspace: 'two',
          repository_root: '/srv/two/app',
          activityRuns: [],
        },
      ]),
    )

    // when
    await createFetchSessions(store, request)()
    for (const workspace of ['one', 'two']) {
      request.mockResolvedValue(
        Response.json([{ name: `/srv/${workspace}/app/x`, rowid: 1 }]),
      )
      const events = await createFetchEvents(store, request)(
        'same',
        0,
        500,
        workspace,
      )
      // then
      expect(events.events[0]?.name).toBe('<repo>/x')
    }
    request.mockResolvedValue(
      Response.json([{ rowid: 1, name: '/srv/two/app/x' }]),
    )
    await expect(createFetchEvents(store, request)('same', 0)).rejects.toThrow(
      'not known yet',
    )
  },
)

for (const status of [200, 503]) {
  test(
    [
      `given ${status === 200 ? 'empty' : 'failed'} sessions`,
      'when fetching summaries',
      'it should not consult the store',
    ].join(', '),
    async () => {
      // given
      const store = createRedactionStore({
        fetchHealth: () => {
          return Promise.reject(new Error('must not ask'))
        },
      })
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(Response.json([], { status }))

      // when, then
      if (status === 200)
        expect(
          await createFetchSessions(store, request)(undefined, true),
        ).toEqual([])
      else
        await expect(createFetchSessions(store, request)()).rejects.toThrow(
          '503',
        )
    },
  )
}

test(
  [
    'given a rejecting health read',
    'when sessions contain data',
    'it should propagate the store rejection',
  ].join(', '),
  async () => {
    // given
    const failure = new Error('health unavailable')
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(Response.json(rows))
    const store = createRedactionStore({
      fetchHealth: async () => ({ home_dir: '/Users/ada' }),
    })

    // when, then
    await expect(
      createFetchSessions(
        {
          ...store,
          base: () => {
            return Promise.reject(failure)
          },
        },
        request,
      )(),
    ).rejects.toBe(failure)
  },
)
