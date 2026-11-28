import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import { createFetchPrompts } from './fetch-prompts'

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
    'given a successful fetch-prompts response',
    'when fetching with workspace identity',
    'it should redact only display fields',
  ].join(', '),
  async () => {
    // given
    await withResponse(
      { system: '/Users/ada/x', user: '/srv/app/x' },
      200,
      async (request) => {
        // when
        const actual = await createFetchPrompts(store, request)(
          'run',
          'builder',
          'one',
        )
        // then
        expect(actual).toEqual({ system: '~/x', user: '<repo>/x' })
      },
    )
  },
)

test(
  [
    'given a rejecting redaction store',
    'when fetching fetch-prompts',
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
      { system: '/Users/ada/x', user: '/srv/app/x' },
      200,
      async (request) => {
        // when, then
        await expect(
          createFetchPrompts(refused, request)('run', 'builder', 'one'),
        ).rejects.toBe(failure)
      },
    )
  },
)

test(
  [
    'given no recorded content',
    'when fetching fetch-prompts',
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
    await withResponse({}, 200, async (request) => {
      // when
      const actual = await createFetchPrompts(refused, request)(
        'run',
        'builder',
        'one',
      )
      // then
      expect(actual).toEqual({ system: null, user: null })
    })
  },
)

test(
  [
    'given HTTP 404',
    'when fetching fetch-prompts',
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
      const actual = await createFetchPrompts(refused, request)(
        'run',
        'builder',
        'one',
      )
      expect(actual).toEqual({ system: null, user: null })
    })
  },
)

test(
  [
    'given HTTP 500',
    'when fetching fetch-prompts',
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
        createFetchPrompts(refused, request)('run', 'builder', 'one'),
      ).rejects.toThrow('500')
    })
  },
)
