import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import { createFetchHandoffFile, handoffHref } from './fetch-handoff-file'

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
    'given a successful fetch-handoff-file response',
    'when fetching with workspace identity',
    'it should redact only display fields',
  ].join(', '),
  async () => {
    // given
    await withResponse('/Users/ada/x /srv/app/x', 200, async (request) => {
      // when
      const actual = await createFetchHandoffFile(store, request)(
        'run',
        'context_handoff/a b/plan.md',
        'one',
      )
      // then
      expect(actual).toBe('~/x <repo>/x')
      expect(handoffHref('run', 'context_handoff/a b/plan.md', 'one')).toBe(
        '/api/sessions/run/handoff/a%20b/plan.md?workspace=one',
      )
    })
  },
)

test(
  [
    'given a rejecting redaction store',
    'when fetching fetch-handoff-file',
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
    await withResponse('/Users/ada/x /srv/app/x', 200, async (request) => {
      // when, then
      await expect(
        createFetchHandoffFile(refused, request)(
          'run',
          'context_handoff/a b/plan.md',
          'one',
        ),
      ).rejects.toBe(failure)
    })
  },
)

test(
  [
    'given no recorded content',
    'when fetching fetch-handoff-file',
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
    await withResponse('', 200, async (request) => {
      // when
      const actual = await createFetchHandoffFile(refused, request)(
        'run',
        'context_handoff/a b/plan.md',
        'one',
      )
      // then
      expect(actual).toEqual('')
    })
  },
)

test(
  [
    'given HTTP 404',
    'when fetching fetch-handoff-file',
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
      await expect(
        createFetchHandoffFile(refused, request)(
          'run',
          'context_handoff/a b/plan.md',
          'one',
        ),
      ).rejects.toThrow('404')
    })
  },
)

test(
  [
    'given HTTP 500',
    'when fetching fetch-handoff-file',
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
      await expect(
        createFetchHandoffFile(refused, request)(
          'run',
          'context_handoff/a b/plan.md',
          'one',
        ),
      ).rejects.toThrow('500')
    })
  },
)
