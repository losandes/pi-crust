import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import { createFetchDecisionRequest } from './fetch-decision-request'

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
    'given a successful fetch-decision-request response',
    'when fetching with workspace identity',
    'it should redact only display fields',
  ].join(', '),
  async () => {
    // given
    await withResponse(
      { present: true, markdown: '/srv/app/x' },
      200,
      async (request) => {
        // when
        const actual = await createFetchDecisionRequest(store, request)(
          'run',
          'one',
        )
        // then
        expect(actual).toEqual({ present: true, markdown: '<repo>/x' })
      },
    )
  },
)

test(
  [
    'given a rejecting redaction store',
    'when fetching fetch-decision-request',
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
      { present: true, markdown: '/srv/app/x' },
      200,
      async (request) => {
        // when, then
        await expect(
          createFetchDecisionRequest(refused, request)('run', 'one'),
        ).rejects.toBe(failure)
      },
    )
  },
)

test(
  [
    'given no recorded content',
    'when fetching fetch-decision-request',
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
    await withResponse({ present: false }, 200, async (request) => {
      // when
      const actual = await createFetchDecisionRequest(refused, request)(
        'run',
        'one',
      )
      // then
      expect(actual).toEqual({ present: false })
    })
  },
)

test(
  [
    'given HTTP 404',
    'when fetching fetch-decision-request',
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
      const actual = await createFetchDecisionRequest(refused, request)(
        'run',
        'one',
      )
      expect(actual).toEqual({ present: false })
    })
  },
)

test(
  [
    'given HTTP 500',
    'when fetching fetch-decision-request',
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
        createFetchDecisionRequest(refused, request)('run', 'one'),
      ).rejects.toThrow('500')
    })
  },
)
