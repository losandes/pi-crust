import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import type { HandoffFile } from '../typedefs/handoff'
import { createFetchHandoff } from './fetch-handoff'

const redactor = createRedactor({ enabled: true, home: '/Users/ada' }).forRun({
  repository_root: '/srv/app',
})
const store: TRedactionStore = {
  base: async () => redactor,
  forRun: (address) => {
    expect(address).toEqual({ runId: 'run', workspace: 'one' })
    return Promise.resolve(redactor)
  },
  remember: () => {},
}
const withResponse = async (
  body: unknown,
  status: number,
  check: (
    request: (...args: Parameters<typeof fetch>) => Promise<Response>,
  ) => Promise<void>,
) => {
  const request = mock<
    (...args: Parameters<typeof fetch>) => Promise<Response>
  >().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  )

  await check(request)
}

test(
  [
    'given a successful fetch-handoff response',
    'when fetching with workspace identity',
    'it should redact only display fields',
  ].join(', '),
  async () => {
    // given
    const file = {
      path: 'context_handoff/plan.md',
      title: '/srv/app/x',
      bytes: 9,
      modified_at: '2026-01-01T00:00:00Z',
    } satisfies HandoffFile
    await withResponse([file], 200, async (request) => {
      // when
      const actual = await createFetchHandoff(store, request)('run', 'one')
      // then
      expect(actual).toEqual([{ ...file, title: '<repo>/x' }])
    })
  },
)

test(
  [
    'given a rejecting redaction store',
    'when fetching fetch-handoff',
    'it should propagate the same rejection',
  ].join(', '),
  async () => {
    // given
    const failure = new Error('health unavailable')
    const refused = {
      ...store,
      forRun: () => {
        return Promise.reject(failure)
      },
    }
    await withResponse(
      [{ path: 'context_handoff/plan.md', title: '/srv/app/x', bytes: 9 }],
      200,
      async (request) => {
        // when, then
        await expect(
          createFetchHandoff(refused, request)('run', 'one'),
        ).rejects.toBe(failure)
      },
    )
  },
)

test(
  [
    'given no recorded content',
    'when fetching fetch-handoff',
    'it should not ask for a redactor',
  ].join(', '),
  async () => {
    // given
    const refused = {
      ...store,
      forRun: () => {
        return Promise.reject(new Error('must not read roots'))
      },
    }
    await withResponse([], 200, async (request) => {
      // when
      const actual = await createFetchHandoff(refused, request)('run', 'one')
      // then
      expect(actual).toEqual([])
    })
  },
)

test(
  [
    'given HTTP 404',
    'when fetching fetch-handoff',
    'it should preserve the existing error or absence behavior',
  ].join(', '),
  async () => {
    // given
    const refused = {
      ...store,
      forRun: () => {
        return Promise.reject(new Error('must not read roots'))
      },
    }
    await withResponse({}, 404, async (request) => {
      // when, then
      const actual = await createFetchHandoff(refused, request)('run', 'one')
      expect(actual).toBeUndefined()
    })
  },
)

test(
  [
    'given HTTP 500',
    'when fetching fetch-handoff',
    'it should preserve the existing error or absence behavior',
  ].join(', '),
  async () => {
    // given
    const refused = {
      ...store,
      forRun: () => {
        return Promise.reject(new Error('must not read roots'))
      },
    }
    await withResponse({}, 500, async (request) => {
      // when, then
      const actual = await createFetchHandoff(refused, request)('run', 'one')
      expect(actual).toBeUndefined()
    })
  },
)
