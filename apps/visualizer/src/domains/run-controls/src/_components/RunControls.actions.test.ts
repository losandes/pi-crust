import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { TWriteResult } from '@/lib/api-client'
import { RunControls } from './RunControls'

/*
 * RunControls.decision-prop.test.ts proves the gh-72 fix itself — the
 * `sendDecision` prop is called instead of an import. This file covers the
 * rest of what RunControls does: the running/consult/finished states, the
 * abort confirm dialog, the steer dialog's overwrite/branch outcomes, and
 * the token-refusal field — none of which the domain-graph edge concerned.
 */

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let originalConsoleError: typeof console.error
let originalFetch: typeof fetch

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: console.error and globalThis.fetch are the external seams these tests stub; this is the adapter that owns the assignment
  console.error = originalConsoleError
  // biome-ignore lint/plugin/no-object-mutation: console.error and globalThis.fetch are the external seams these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = originalFetch
})

originalConsoleError = console.error
originalFetch = globalThis.fetch

type TRequest = { url: string; body: unknown }

const stubFetch = (status: number, body: unknown): TRequest[] => {
  const requests: TRequest[] = []
  // biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    // biome-ignore lint/plugin/no-array-mutation: accumulating the requests this one stub receives in this one test
    requests.push({
      url: String(url),
      body:
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    return Promise.resolve({
      ok: status < 400,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response)
  }) as unknown as typeof fetch
  return requests
}

const noopSendDecision = (): Promise<TWriteResult> =>
  Promise.resolve({ ok: true, data: {} })

const mount = async (
  props: Readonly<{
    runId: string
    status: string
    workspace?: string
    consultStep?: string
    onConsultSent?: (mode: 'ask' | 'amend', question: string) => void
    onMessageSent?: (kind: 'steer' | 'follow_up', text: string) => void
    replaying?: readonly string[]
    standalone?: boolean
  }>,
): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(
      createElement(RunControls, { sendDecision: noopSendDecision, ...props }),
    )
  })
  return container
}

const findButton = (
  container: HTMLDivElement,
  label: string,
): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes(label),
  ) ?? null

const click = async (element: Element | null | undefined): Promise<void> => {
  expect(element).toBeTruthy()
  // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the click (and whatever it settles) triggers, not an await in this body
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

/**
 * Calls the `onChange` React registered on the textarea directly, the same
 * handler a real keystroke would call — dispatching a native `input` event
 * does not reach it under happy-dom + React 19 in this test environment
 * (confirmed on a minimal controlled-input component before writing these).
 */
const type = async (textarea: Element | null, value: string): Promise<void> => {
  expect(textarea).not.toBeNull()
  const propsKey = Object.keys(textarea as object).find((key) =>
    key.startsWith('__reactProps$'),
  )
  expect(propsKey).toBeDefined()
  const onChange = (textarea as unknown as Record<string, unknown>)[
    propsKey as string
  ] as Readonly<{ onChange: (event: unknown) => void }>
  // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state update the handler triggers, not an await in this body
  await act(async () => {
    onChange.onChange({ target: { value } })
  })
}

// --- running ---------------------------------------------------------------

test(
  [
    'given RunControls for a run that is running, with no text typed',
    'when "steer now" is pressed',
    'it should show the write-something problem and never call fetch',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({ runId: 'run-r1', status: 'running' })

    // when
    await click(findButton(container, 'steer now'))

    // then
    expect(container.textContent).toContain(
      'Write what you want to say before you steer.',
    )
    expect(requests).toEqual([])
  },
)

test(
  [
    'given RunControls for a run that is running, with text typed',
    'when "steer now" is pressed',
    'it should POST a steer message, call onMessageSent, and show the done banner',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const sent: [string, string][] = []
    const container = await mount({
      runId: 'run-r2',
      status: 'running',
      onMessageSent: (kind, text) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        sent.push([kind, text])
      },
    })
    await type(container.querySelector('textarea'), 'steer left')

    // when
    await click(findButton(container, 'steer now'))

    // then
    expect(requests[0]?.body).toEqual({
      kind: 'steer',
      message: 'steer left',
      from: 'the web app',
    })
    expect(sent).toEqual([['steer', 'steer left']])
    expect(container.textContent).toContain(
      'steering sent \u2014 it will appear in the conversation above',
    )
  },
)

test(
  [
    'given RunControls for a run that is running, with text typed',
    'when "queue for after" is pressed',
    'it should POST a follow_up message and call onMessageSent',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const sent: [string, string][] = []
    const container = await mount({
      runId: 'run-r3',
      status: 'running',
      onMessageSent: (kind, text) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        sent.push([kind, text])
      },
    })
    await type(container.querySelector('textarea'), 'ask it this later')

    // when
    await click(findButton(container, 'queue for after'))

    // then
    expect(requests[0]?.body).toMatchObject({ kind: 'follow_up' })
    expect(sent).toEqual([['follow_up', 'ask it this later']])
  },
)

test(
  [
    'given RunControls for a run that is running',
    'when "abort" is pressed and then confirmed',
    'it should open the confirm dialog and, on confirm, POST an abort message',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({ runId: 'run-r4', status: 'running' })

    // when
    await click(findButton(container, 'abort'))

    // then — the confirm dialog opened
    const confirmDialog = Array.from(container.querySelectorAll('dialog')).find(
      (dialog) => dialog.open,
    )
    expect(confirmDialog).toBeTruthy()

    // when
    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'abort the run',
      ),
    )

    // then
    expect(requests[0]?.body).toMatchObject({ kind: 'abort' })
    expect(confirmDialog?.open).toBe(false)
  },
)

test(
  [
    'given RunControls for a run that is running',
    'when "abort" is pressed and then cancelled',
    'it should close the dialog without ever calling fetch',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({ runId: 'run-r5', status: 'running' })
    await click(findButton(container, 'abort'))
    const confirmDialog = Array.from(container.querySelectorAll('dialog')).find(
      (dialog) => dialog.open,
    )

    // when
    await click(
      Array.from(confirmDialog?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent === 'cancel',
      ),
    )

    // then
    expect(requests).toEqual([])
    expect(confirmDialog?.open).toBe(false)
  },
)

// --- waiting -----------------------------------------------------------

test(
  [
    'given RunControls for a run waiting on a gate, with text typed in',
    'when "answer and continue" is pressed',
    'it should call the injected sendDecision with the answer action and the typed text',
  ].join(', '),
  async () => {
    // given
    const calls: unknown[][] = []
    const container = await mount({
      runId: 'run-w1',
      status: 'waiting',
      sendDecision: (...args: unknown[]) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        calls.push(args)
        return Promise.resolve({ ok: true, data: {} })
      },
    } as never)
    await type(container.querySelector('textarea'), 'option B')

    // when
    await click(findButton(container, 'answer and continue'))

    // then
    expect(calls).toEqual([['run-w1', 'answer', 'option B', undefined]])
  },
)

test(
  [
    'given RunControls for a run waiting on a gate, with text typed in',
    'when "reject and send back" is pressed',
    'it should call the injected sendDecision with the reject action',
  ].join(', '),
  async () => {
    // given
    const calls: unknown[][] = []
    const container = await mount({
      runId: 'run-w2',
      status: 'waiting',
      sendDecision: (...args: unknown[]) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        calls.push(args)
        return Promise.resolve({ ok: true, data: {} })
      },
    } as never)
    await type(container.querySelector('textarea'), 'do it differently')

    // when
    await click(findButton(container, 'reject and send back'))

    // then
    expect(calls).toEqual([
      ['run-w2', 'reject', 'do it differently', undefined],
    ])
  },
)

test(
  [
    'given RunControls for a run waiting on a gate, with no text typed',
    'when "reject and send back" is pressed',
    'it should show the write-something problem rather than calling sendDecision',
  ].join(', '),
  async () => {
    // given
    const calls: unknown[][] = []
    const container = await mount({
      runId: 'run-w3',
      status: 'waiting',
      sendDecision: (...args: unknown[]) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        calls.push(args)
        return Promise.resolve({ ok: true, data: {} })
      },
    } as never)

    // when
    await click(findButton(container, 'reject and send back'))

    // then
    expect(container.textContent).toContain(
      'Write what you want to say before you reject.',
    )
    expect(calls).toEqual([])
  },
)

// --- finished, no consult ---------------------------------------------

test(
  [
    'given RunControls for a run that has finished, with no activity to consult',
    'when it is rendered',
    'it should say only that the run has finished, disable the textarea and render no action buttons',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({ runId: 'run-f1', status: 'success' })

    // then
    expect(container.textContent).toContain('This run has finished.')
    expect(container.querySelector('textarea')?.disabled).toBe(true)
    expect(container.querySelectorAll('.actions button').length).toBe(0)
  },
)

// --- finished, consult, not failed --------------------------------------

test(
  [
    'given RunControls for a successful run with an activity to consult, with text typed',
    'when "ask" is pressed',
    'it should POST an ask consult and call onConsultSent, and should not offer a resume button',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const sent: [string, string][] = []
    const container = await mount({
      runId: 'run-c1',
      status: 'success',
      consultStep: 'build',
      onConsultSent: (mode, question) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        sent.push([mode, question])
      },
    })
    expect(findButton(container, 'pick it up where it stopped')).toBeNull()
    await type(container.querySelector('textarea'), 'why did this fail?')

    // when
    await click(
      Array.from(container.querySelectorAll('button')).find((button) =>
        (button.textContent ?? '').includes('ask'),
      ),
    )

    // then
    expect(requests[0]?.url).toBe(
      '/api/sessions/run-c1/activities/build/consult',
    )
    expect(requests[0]?.body).toEqual({
      mode: 'ask',
      question: 'why did this fail?',
    })
    expect(sent).toEqual([['ask', 'why did this fail?']])
  },
)

test(
  [
    'given RunControls for a successful run with an activity to consult, with no text typed',
    'when "amend this activity\'s document" is pressed',
    'it should show the write-something problem rather than calling fetch',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({
      runId: 'run-c2',
      status: 'success',
      consultStep: 'build',
    })

    // when
    await click(findButton(container, "amend this activity's document"))

    // then
    expect(container.textContent).toContain(
      'Write what you want to say before you amend.',
    )
    expect(requests).toEqual([])
  },
)

test(
  [
    'given RunControls for a successful run with an activity to consult, with text typed',
    'when "amend this activity\'s document" is pressed',
    'it should POST an amend consult and call onConsultSent',
  ].join(', '),
  async () => {
    // given
    stubFetch(200, {})
    const sent: [string, string][] = []
    const container = await mount({
      runId: 'run-c3',
      status: 'success',
      consultStep: 'build',
      onConsultSent: (mode, question) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one mock receives in this one test
        sent.push([mode, question])
      },
    })
    await type(container.querySelector('textarea'), 'rewrite the summary')

    // when
    await click(findButton(container, "amend this activity's document"))

    // then
    expect(sent).toEqual([['amend', 'rewrite the summary']])
  },
)

test(
  [
    'given RunControls for a successful (not failed) run, with activities to replay',
    'when "steer from here\u2026" is pressed with no text typed',
    'it should show the write-something problem and never open the steer dialog',
  ].join(', '),
  async () => {
    // given
    const container = await mount({
      runId: 'run-c4',
      status: 'success',
      consultStep: 'build',
      replaying: ['plan', 'build'],
    })

    // when
    await click(findButton(container, 'steer from here'))

    // then
    expect(container.textContent).toContain(
      'Write what you want to say before you steer.',
    )
    expect(container.querySelectorAll('dialog')[1]?.open ?? false).toBe(false)
  },
)

test(
  [
    'given RunControls for a successful run, with nothing left to replay',
    'when it is rendered',
    'it should disable "steer from here\u2026"',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({
      runId: 'run-c5',
      status: 'success',
      consultStep: 'build',
      replaying: [],
    })

    // then
    expect(findButton(container, 'steer from here')?.disabled).toBe(true)
  },
)

// --- finished, consult, failed -----------------------------------------

test(
  [
    'given RunControls for a failed run with an activity to consult, with no text typed',
    'when "pick it up where it stopped" is pressed',
    'it should POST a resume with an empty note and show the "nothing re-runs" banner',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({
      runId: 'run-f2',
      status: 'fail',
      consultStep: 'build',
    })
    expect(container.textContent).toContain(
      'Asking or amending changes a document',
    )

    // when
    await click(findButton(container, 'pick it up where it stopped'))

    // then
    expect(requests[0]?.url).toBe('/api/sessions/run-f2/resume')
    expect(requests[0]?.body).toEqual({ note: '' })
    expect(container.textContent).toContain('nothing already green re-runs')
  },
)

test(
  [
    'given RunControls for a failed run with an activity to consult, with text typed',
    'when "pick it up where it stopped" is pressed',
    'it should POST the typed text as the resume note and show the "standing instruction" banner',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({
      runId: 'run-f3',
      status: 'fail',
      consultStep: 'build',
    })
    await type(container.querySelector('textarea'), 'watch the flaky step')

    // when
    await click(findButton(container, 'pick it up where it stopped'))

    // then
    expect(requests[0]?.body).toEqual({ note: 'watch the flaky step' })
    expect(container.textContent).toContain('standing')
  },
)

test(
  [
    'given RunControls for a failed run, with activities to replay and text typed',
    'when "steer from here\u2026" is pressed and then "overwrite" is chosen',
    'it should POST an overwrite steer and show the overwrite banner',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({
      runId: 'run-f4',
      status: 'fail',
      consultStep: 'build',
      replaying: ['plan', 'build'],
    })
    await type(container.querySelector('textarea'), 'fix the flaky assertion')

    // when
    await click(findButton(container, 'steer from here'))
    const dialogs = container.querySelectorAll('dialog')
    const steerDialog = Array.from(dialogs).find((dialog) => dialog.open)
    expect(steerDialog).toBeTruthy()
    await click(
      Array.from(steerDialog?.querySelectorAll('button') ?? []).find((button) =>
        button.textContent?.startsWith('overwrite'),
      ),
    )

    // then
    expect(requests[0]?.url).toBe('/api/sessions/run-f4/activities/build/steer')
    expect(requests[0]?.body).toEqual({
      target: 'overwrite',
      note: 'fix the flaky assertion',
    })
    expect(container.textContent).toContain(
      'steering sent \u2014 these activities are running again',
    )
    expect(steerDialog?.open).toBe(false)
  },
)

test(
  [
    'given RunControls for a failed run, with activities to replay and text typed',
    'when "steer from here\u2026" is pressed and then "branch" is chosen',
    'it should POST a branch steer and render a link to the new run\u2019s id the server returned',
  ].join(', '),
  async () => {
    // given
    stubFetch(200, { branch_run_id: 'run-f5-branch' })
    const container = await mount({
      runId: 'run-f5',
      status: 'fail',
      consultStep: 'build',
      workspace: 'alpha',
      replaying: ['plan', 'build'],
    })
    await type(container.querySelector('textarea'), 'branch it')
    await click(findButton(container, 'steer from here'))
    const steerDialog = Array.from(container.querySelectorAll('dialog')).find(
      (dialog) => dialog.open,
    )

    // when
    await click(
      Array.from(steerDialog?.querySelectorAll('button') ?? []).find((button) =>
        button.textContent?.startsWith('branch'),
      ),
    )

    // then
    expect(container.textContent).toContain(
      'branching \u2014 a new run is starting',
    )
    const link = container.querySelector('a')
    expect(link?.textContent).toContain('run-f5-branch')
    expect(link?.getAttribute('href')).toBe('#/alpha:run-f5-branch')
  },
)

test(
  [
    'given RunControls, after a steer dialog is opened',
    'when its cancel button is pressed',
    'it should close the dialog without calling fetch',
  ].join(', '),
  async () => {
    // given
    const requests = stubFetch(200, {})
    const container = await mount({
      runId: 'run-f6',
      status: 'fail',
      consultStep: 'build',
      replaying: ['build'],
    })
    await type(container.querySelector('textarea'), 'note')
    await click(findButton(container, 'steer from here'))
    const steerDialog = Array.from(container.querySelectorAll('dialog')).find(
      (dialog) => dialog.open,
    )

    // when
    await click(steerDialog?.querySelector('button'))

    // then
    expect(requests).toEqual([])
    expect(steerDialog?.open).toBe(false)
  },
)

// --- refusal and the token field -----------------------------------------

test(
  [
    'given RunControls, after a write is refused',
    'when the token field\u2019s save button is pressed',
    'it should write the token and replace the problem with "Token saved."',
  ].join(', '),
  async () => {
    // given
    stubFetch(401, '')
    const container = await mount({ runId: 'run-t1', status: 'running' })
    await type(container.querySelector('textarea'), 'steer left')
    await click(findButton(container, 'steer now'))
    expect(container.querySelector('input[type="password"]')).not.toBeNull()

    // when
    await type(container.querySelector('input[type="password"]'), 'new-token')
    await click(findButton(container, 'save token'))

    // then
    expect(container.textContent).toContain('Token saved. Try that again.')
  },
)

// --- standalone --------------------------------------------------------

test(
  [
    'given RunControls with standalone set to true',
    'when it is rendered',
    'it should still render its header and textarea (the standalone gutter is CSS-only)',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({
      runId: 'run-s1',
      status: 'running',
      standalone: true,
    })

    // then
    expect(container.querySelector('section')).not.toBeNull()
    expect(container.querySelector('textarea')).not.toBeNull()
  },
)
