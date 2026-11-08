import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { TWriteResult } from '@/lib/api-client'
import { RunControls } from './RunControls'

/*
 * gh-72 §2.2 gives `run-controls` no edge to `decisions`: RunControls no
 * longer imports `sendDecision` from `@/domains/decisions` itself (that is
 * what architecture.test.ts's domain-graph check proves, at the import
 * level). These tests prove the other half of that fix actually works at
 * runtime — that the "waiting" actions call the `sendDecision` FUNCTION the
 * caller injects, with the arguments a caller (and, in turn, the server)
 * depends on, and that the component still reacts to what that call settles
 * with — rather than the prop being accepted and silently ignored once the
 * import is gone.
 *
 * Typing into the controlled textarea could not be simulated reliably in
 * this environment (happy-dom + React 19's controlled-input event dispatch
 * did not deliver a synthetic `input`/`change` event through `act()` in
 * manual testing here), so these tests exercise the one decision action that
 * needs no typed text first: "continue without answering" (the `approve`
 * action). That is enough to prove the prop is wired end to end; the
 * `answer`/`reject` literals sit beside `approve` in the same handler style
 * in RunControls.tsx and are covered at the import level by
 * architecture.test.ts's domain-graph check.
 */

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let originalConsoleError: typeof console.error

afterEach(() => {
  // biome-ignore lint/plugin/no-object-mutation: console.error is the external seam these tests stub; this is the adapter that owns the assignment
  console.error = originalConsoleError
})

originalConsoleError = console.error

type TSendDecisionCall = readonly [
  runId: string,
  action: 'approve' | 'reject' | 'answer',
  text: string,
  workspace: string | undefined,
]

const mount = async (
  props: Readonly<{
    runId: string
    status: string
    workspace?: string
    sendDecision: (
      runId: string,
      action: 'approve' | 'reject' | 'answer',
      text: string,
      workspace?: string,
    ) => Promise<TWriteResult>
  }>,
): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(createElement(RunControls, props))
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

test(
  [
    'given RunControls for a run that is waiting on a gate',
    'when "continue without answering" is pressed',
    'it should call the injected sendDecision with the approve action, empty text and the given workspace',
  ].join(', '),
  async () => {
    // given
    const calls: TSendDecisionCall[] = []
    const sendDecision = (
      runId: string,
      action: 'approve' | 'reject' | 'answer',
      text: string,
      workspace?: string,
    ): Promise<TWriteResult> => {
      // biome-ignore lint/plugin/no-array-mutation: accumulating the calls this one mock receives in this one test
      calls.push([runId, action, text, workspace])
      return Promise.resolve({ ok: true, data: {} })
    }
    const container = await mount({
      runId: 'run-waiting-1',
      status: 'waiting',
      workspace: 'alpha',
      sendDecision,
    })

    // when
    const button = findButton(container, 'continue without answering')
    expect(button).not.toBeNull()
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state updates the click and the settled promise trigger, not an await in this body
    await act(async () => {
      button?.click()
    })

    // then
    expect(calls).toEqual([['run-waiting-1', 'approve', '', 'alpha']])
  },
)

test(
  [
    'given RunControls for a run that is waiting on a gate, and a sendDecision that resolves refused',
    'when "continue without answering" is pressed and the promise settles',
    'it should surface the problem text sendDecision returned, proving the component reacts to what the injected call settles with',
  ].join(', '),
  async () => {
    // given
    const sendDecision = (): Promise<TWriteResult> =>
      Promise.resolve({ ok: false, problem: 'the gate is already closed' })
    const container = await mount({
      runId: 'run-waiting-2',
      status: 'waiting',
      sendDecision,
    })
    const button = findButton(container, 'continue without answering')

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state update the settled promise triggers, not an await in this body
    await act(async () => {
      button?.click()
    })

    // then
    const problemText = Array.from(container.querySelectorAll('p'))
      .map((paragraph) => paragraph.textContent ?? '')
      .join(' ')
    expect(problemText).toContain('the gate is already closed')
  },
)

test(
  [
    'given RunControls for a run that is still running, not waiting',
    'when it is rendered',
    'it should never call the injected sendDecision',
  ].join(', '),
  async () => {
    // given
    const calls: TSendDecisionCall[] = []
    const sendDecision = (
      runId: string,
      action: 'approve' | 'reject' | 'answer',
      text: string,
      workspace?: string,
    ): Promise<TWriteResult> => {
      // biome-ignore lint/plugin/no-array-mutation: accumulating the calls this one mock receives in this one test
      calls.push([runId, action, text, workspace])
      return Promise.resolve({ ok: true, data: {} })
    }

    // when
    await mount({
      runId: 'run-running-1',
      status: 'running',
      sendDecision,
    })

    // then
    expect(calls).toEqual([])
  },
)
