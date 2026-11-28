import { expect, mock, test } from 'bun:test'
import { createRedactor, type TRedactionStore } from '@/lib/redaction'
import type { GateResult } from '../typedefs/activity-run'
import { createFetchGates } from './fetch-gates'

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
    'given a successful fetch-gates response',
    'when fetching with workspace identity',
    'it should redact only display fields',
  ].join(', '),
  async () => {
    // given
    const gate = {
      id: 1,
      run_id: 'run',
      activity_run_id: 'build',
      passed: 0,
      created_at: '2026-01-01T00:00:00Z',
      gate: 'check',
      violations_json: '["/Users/ada/x"]',
      checks_json: '[{"note":"/srv/app/x"}]',
    } satisfies GateResult
    await withResponse([gate], 200, async (request) => {
      // when
      const actual = await createFetchGates(store, request)('run', 'one')
      // then
      expect(actual).toEqual([
        {
          ...gate,
          violations_json: '["~/x"]',
          checks_json: '[{"note":"<repo>/x"}]',
        },
      ])
    })
  },
)

test(
  [
    'given a rejecting redaction store',
    'when fetching fetch-gates',
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
      [
        {
          violations_json: '["/Users/ada/x"]',
          checks_json: '[{"note":"/srv/app/x"}]',
          gate: 'check',
        },
      ],
      200,
      async (request) => {
        // when, then
        await expect(
          createFetchGates(refused, request)('run', 'one'),
        ).rejects.toBe(failure)
      },
    )
  },
)

test(
  [
    'given no recorded content',
    'when fetching fetch-gates',
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
      const actual = await createFetchGates(refused, request)('run', 'one')
      // then
      expect(actual).toEqual([])
    })
  },
)

test(
  [
    'given HTTP 404',
    'when fetching fetch-gates',
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
        createFetchGates(refused, request)('run', 'one'),
      ).rejects.toThrow('404')
    })
  },
)

test(
  [
    'given HTTP 500',
    'when fetching fetch-gates',
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
        createFetchGates(refused, request)('run', 'one'),
      ).rejects.toThrow('500')
    })
  },
)
