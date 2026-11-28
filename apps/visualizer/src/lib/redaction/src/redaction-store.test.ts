import { expect, mock, test } from 'bun:test'
import { createRedactionStore } from './redaction-store'

const health = { redact_paths: true, home_dir: '/Users/ada' }

test(
  [
    'given simultaneous health readers',
    'when reading again after success',
    'it should share and retain one request',
  ].join(', '),
  async () => {
    // given
    let calls = 0
    const store = createRedactionStore({
      fetchHealth: () => {
        calls++
        return Promise.resolve(health)
      },
    })
    // when
    const first = store.base()
    const second = store.base()
    const result = await first
    // then
    expect(await second).toBe(result)
    expect(await store.base()).toBe(result)
    expect(calls).toBe(1)
  },
)

for (const failure of ['reject', 'missing'] as const) {
  test(
    [
      `given a ${failure} health response`,
      'when retrying',
      'it should refuse data then request health again',
    ].join(', '),
    async () => {
      // given
      let calls = 0
      const store = createRedactionStore({
        fetchHealth: () => {
          calls++
          if (calls === 1) {
            if (failure === 'reject')
              return Promise.reject(new Error('offline'))
            return Promise.resolve({ ok: true })
          }
          return Promise.resolve(health)
        },
      })
      // when, then
      await expect(store.base()).rejects.toThrow(
        'redaction: the API has not reported its path-redaction setting',
      )
      expect((await store.base()).text('/Users/ada/x')).toBe('~/x')
      expect(calls).toBe(2)
    },
  )
}

test(
  [
    'given disabled redaction and no remembered roots',
    'when reading a run',
    'it should resolve an identity redactor',
  ].join(', '),
  async () => {
    // given
    const store = createRedactionStore({
      fetchHealth: async () => ({ redact_paths: false }),
    })
    // when
    const result = await store.forRun({ runId: 'unknown' })
    // then
    expect(result.text('/Users/ada/x')).toBe('/Users/ada/x')
  },
)

test(
  [
    'given one run id in multiple workspaces',
    'when remembering each address',
    'it should never borrow another workspace roots',
  ].join(', '),
  async () => {
    // given
    const store = createRedactionStore({ fetchHealth: async () => health })
    store.remember(
      { runId: 'run', workspace: 'one' },
      { repository_root: '/srv/one/app' },
    )
    // when, then
    expect(
      (await store.forRun({ runId: 'run', workspace: 'one' })).text(
        '/srv/one/app/x',
      ),
    ).toBe('<repo>/x')
    await expect(
      store.forRun({ runId: 'run', workspace: 'two' }),
    ).rejects.toThrow('redaction: the roots of run run are not known yet')
    await expect(store.forRun({ runId: 'run' })).rejects.toThrow(
      'not known yet',
    )
    // when
    store.remember(
      { runId: 'run', workspace: 'two' },
      { workspace_root: '/srv/two/app' },
    )
    store.remember({ runId: 'run' }, { repository_root: '/srv/unqualified' })
    // then
    expect(
      (await store.forRun({ runId: 'run', workspace: 'two' })).text(
        '/srv/two/app/x',
      ),
    ).toBe('<worktree>/x')
    expect(
      (await store.forRun({ runId: 'run', workspace: '' })).text(
        '/srv/unqualified/x',
      ),
    ).toBe('<repo>/x')
  },
)

test(
  [
    'given the live health adapter',
    'when health fails then succeeds',
    'it should request the endpoint and validate the status',
  ].join(', '),
  async () => {
    // given
    const request = mock<
      (...args: Parameters<typeof fetch>) => Promise<Response>
    >().mockResolvedValue(new Response('', { status: 503 }))
    const store = createRedactionStore({ request })

    // when, then
    await expect(store.base()).rejects.toThrow('has not reported')
    request.mockResolvedValue(Response.json(health))
    expect((await store.base()).text('/Users/ada/x')).toBe('~/x')
    expect(request).toHaveBeenCalledWith('/api/health')
  },
)
