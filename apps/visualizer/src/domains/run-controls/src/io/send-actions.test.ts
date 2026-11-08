import { afterEach, expect, test } from 'bun:test'
import { sendConsult } from './send-consult'
import { sendMessage } from './send-message'
import { sendResume } from './send-resume'
import { sendSteer } from './send-steer'

/*
 * Each of these is a thin `post()` wrapper (see lib/api-client/src/client.ts
 * for the settlement contract itself). These tests exist to prove each one
 * builds the URL and body `RunControls` depends on — not to re-test `post`.
 */

let originalFetch: typeof fetch
let requests: Array<{ url: string; init: RequestInit | undefined }> = []

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = originalFetch
})

originalFetch = globalThis.fetch

const stubFetch = (body: unknown) => {
  requests = []
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    // biome-ignore lint/plugin/no-array-mutation: accumulating the requests this one stub receives in this one test
    requests.push({ url: String(url), init })
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response)
  }) as unknown as typeof fetch
}

test(
  [
    'given run-controls::sendMessage',
    'when told to steer a running agent with a workspace',
    'it should POST the kind, message and workspace scope to /messages',
  ].join(', '),
  async () => {
    // given
    stubFetch({})

    // when
    const result = await sendMessage('run-1', 'steer', 'go left', 'alpha')

    // then
    expect(requests[0]?.url).toBe(
      '/api/sessions/run-1/messages?workspace=alpha',
    )
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      kind: 'steer',
      message: 'go left',
      from: 'the web app',
    })
    expect(result).toEqual({ ok: true, data: {} })
  },
)

test(
  [
    'given run-controls::sendConsult',
    'when asking a finished activity a question',
    'it should POST the mode and question to that activity\u2019s consult endpoint',
  ].join(', '),
  async () => {
    // given
    stubFetch({ started: true })

    // when
    await sendConsult('run-2', 'build', 'ask', 'why did this fail?')

    // then
    expect(requests[0]?.url).toBe(
      '/api/sessions/run-2/activities/build/consult',
    )
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      mode: 'ask',
      question: 'why did this fail?',
    })
  },
)

test(
  [
    'given run-controls::sendResume',
    'when picking a finished run back up with a note',
    'it should POST the note to that run\u2019s resume endpoint',
  ].join(', '),
  async () => {
    // given
    stubFetch({})

    // when
    await sendResume('run-3', 'beta', 'watch the flaky test')

    // then
    expect(requests[0]?.url).toBe('/api/sessions/run-3/resume?workspace=beta')
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      note: 'watch the flaky test',
    })
  },
)

test(
  [
    'given run-controls::sendResume',
    'when no note is given',
    'it should POST an empty note rather than omitting the field',
  ].join(', '),
  async () => {
    // given
    stubFetch({})

    // when
    await sendResume('run-4')

    // then
    expect(requests[0]?.url).toBe('/api/sessions/run-4/resume')
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ note: '' })
  },
)

test(
  [
    'given run-controls::sendSteer',
    'when branching rather than overwriting',
    'it should POST the target and note to that activity\u2019s steer endpoint',
  ].join(', '),
  async () => {
    // given
    stubFetch({ branch_run_id: 'run-5-branch' })

    // when
    const result = await sendSteer(
      'run-5',
      'plan',
      'branch',
      'try again',
      'alpha',
    )

    // then
    expect(requests[0]?.url).toBe(
      '/api/sessions/run-5/activities/plan/steer?workspace=alpha',
    )
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      target: 'branch',
      note: 'try again',
    })
    expect(result).toEqual({
      ok: true,
      data: { branch_run_id: 'run-5-branch' },
    })
  },
)
