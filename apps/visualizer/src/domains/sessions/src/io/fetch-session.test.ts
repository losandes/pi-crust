import { expect, mock, test } from 'bun:test'
import type { ActivityRun } from '@shared/types'
import { createFetchEvents } from '@/domains/events'
import {
  createRedactionStore,
  type TRunAddress,
  type TRunRoots,
} from '@/lib/redaction'
import { createFetchSession } from './fetch-session'

const activityRun = {
  activity_run_id: 'build',
  run_id: 'run',
  seq: 1,
  name: 'build',
  kind: 'agent',
  status: 'fail',
  started_at: '2026-01-01T00:00:00Z',
  ended_at: '2026-01-01T00:00:00Z',
  error: '/Users/ada/x',
  description: '/Users/ada/a/app/x',
  owner: 'builder',
} satisfies ActivityRun

const session = {
  run_id: 'run',
  workspace: 'one',
  repository_root: '/Users/ada/a/app',
  workspace_root: '/Users/ada/wt/one',
  request: '/Users/ada/a/app/x',
  name: '/Users/ada/x',
  status: 'success',
}
for (const enabled of [true, false]) {
  test(
    [
      `given a session with redaction ${enabled}`,
      'when fetching detail',
      'it should retain identities and redact only display text',
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
      >().mockResolvedValue(
        Response.json({
          session,
          handoff_dir: '/Users/ada/wt/one/handoff',
          activityRuns: [activityRun],
        }),
      )

      // when
      const actual = await createFetchSession(
        {
          ...store,
          remember: remembered,
        },
        request,
      )('run')
      const run = await store.forRun({ runId: 'run' })
      // then
      expect(actual.session).toMatchObject({
        repository_root: session.repository_root,
        workspace_root: session.workspace_root,
        status: session.status,
        repository_location: enabled ? '~/a/app' : session.repository_root,
        workspace_location: enabled ? '~/wt/one' : session.workspace_root,
        request: enabled ? '<repo>/x' : session.request,
        name: enabled ? '~/x' : session.name,
      })
      expect(actual.activityRuns).toEqual([
        {
          ...activityRun,
          error: enabled ? '~/x' : activityRun.error,
          description: enabled ? '<repo>/x' : activityRun.description,
        },
      ])
      expect(actual.handoff_dir).toBe(
        enabled ? '<worktree>/handoff' : '/Users/ada/wt/one/handoff',
      )
      expect(run.text('/Users/ada/wt/one/handoff/plan.md')).toBe(
        `${actual.handoff_dir}/plan.md`,
      )
      expect(actual.usage).toEqual({ read: 0, written: 0 })
      expect(actual.agents).toEqual([])
      expect(remembered.mock.calls.map(([address]) => address)).toEqual([
        { runId: 'run', workspace: undefined },
        { runId: 'run', workspace: 'one' },
      ])
      expect(remembered.mock.calls[0]?.[1]).toEqual({
        repository_root: session.repository_root,
        workspace_root: session.workspace_root,
      })
    },
  )
}

for (const workspace of [undefined, 'one']) {
  test(
    [
      `given a session fetched with workspace ${workspace}`,
      'when events use qualified and unqualified addresses',
      'it should remember only the requested and returned addresses',
    ].join(', '),
    async () => {
      // given
      const store = createRedactionStore({
        fetchHealth: async () => ({ home_dir: '/Users/ada' }),
      })
      const request = mock<
        (...args: Parameters<typeof fetch>) => Promise<Response>
      >().mockResolvedValue(Response.json({ session }))

      // when
      await createFetchSession(store, request)('run', workspace)
      request.mockImplementation(async () =>
        Response.json([{ rowid: 1, name: '/Users/ada/a/app/x' }]),
      )
      // then
      expect(
        (await createFetchEvents(store, request)('run', 0, 500, 'one'))
          .events[0]?.name,
      ).toBe('<repo>/x')
      if (workspace === undefined)
        expect(
          (await createFetchEvents(store, request)('run', 0)).events[0]?.name,
        ).toBe('<repo>/x')
      else
        await expect(
          createFetchEvents(store, request)('run', 0),
        ).rejects.toThrow('not known yet')
    },
  )
}

test(
  [
    'given old detail without roots or optional collections',
    'when fetching it',
    'it should add defaults but no locations',
  ].join(', '),
  async () => {
    // given
    const store = createRedactionStore({
      fetchHealth: async () => ({ home_dir: '/Users/ada' }),
    })
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(
      Response.json({
        session: { run_id: 'run', workspace: 'one', workspace_root: null },
      }),
    )

    // when
    const actual = await createFetchSession(store, request)('run', 'one')
    // then
    expect(actual.session.repository_location).toBeUndefined()
    expect(actual.session.workspace_location).toBeUndefined()
    expect(actual.activityRuns).toEqual([])
    expect(actual.handoff_dir).toBe('')
  },
)

test(
  [
    'given a rejecting store',
    'when detail succeeds',
    'it should propagate the same rejection',
  ].join(', '),
  async () => {
    // given
    const failure = new Error('health unavailable')
    const store = createRedactionStore({
      fetchHealth: async () => ({ home_dir: '/Users/ada' }),
    })
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(Response.json({ session }))

    // when, then
    await expect(
      createFetchSession(
        {
          ...store,
          base: () => {
            return Promise.reject(failure)
          },
        },
        request,
      )('run'),
    ).rejects.toBe(failure)
  },
)

test(
  [
    'given an unsuccessful detail response',
    'when fetching it',
    'it should preserve the transport failure without reading health',
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
    >().mockResolvedValue(new Response('', { status: 404 }))

    // when, then
    await expect(createFetchSession(store, request)('run')).rejects.toThrow(
      '404',
    )
  },
)
