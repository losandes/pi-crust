import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { TTreeWarning } from '../usecases/warnings'
import { TreeWarnings } from './TreeWarnings'

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

const REPEATED_PATH =
  'warn read of node_modules by bash (matched in a shell command, best-effort)'

const mount = async (
  warnings: readonly TTreeWarning[],
): Promise<{ container: HTMLDivElement; messages: readonly string[] }> => {
  const messages: string[] = []
  // biome-ignore lint/plugin/no-object-mutation: console.error is the external seam this test stubs to capture React's render-time warnings
  console.error = (...args: unknown[]) => {
    // biome-ignore lint/plugin/no-array-mutation: accumulating captured console output for this one mount, local to the test
    messages.push(args.map(String).join(' '))
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(createElement(TreeWarnings, { warnings }))
  })

  return { container, messages }
}

test(
  [
    'given TreeWarnings',
    'when one warning repeats the same path twice in its paths array',
    'it should render both lines without a duplicate-key console warning',
  ].join(', '),
  async () => {
    // given
    const warnings: readonly TTreeWarning[] = [
      {
        kind: 'refusal',
        activities: ['build'],
        activityRunIds: ['a80432ce_03_build'],
        stage: 'build',
        paths: [REPEATED_PATH, REPEATED_PATH],
        note: '',
      },
    ]

    // when
    const { container, messages } = await mount(warnings)
    // biome-ignore lint/plugin/no-object-mutation: restoring the real console.error before the assertions run, so a failing expectation does not swallow the runner's own reporting
    console.error = originalConsoleError

    // then
    expect(
      messages.some((message) =>
        message.includes('Encountered two children with the same key'),
      ),
    ).toBe(false)
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(2)
    expect(items[0]?.textContent).toBe(REPEATED_PATH)
    expect(items[1]?.textContent).toBe(REPEATED_PATH)
  },
)

test(
  [
    'given TreeWarnings',
    'when two warnings in one group share kind, stage, Activity Run ids and paths',
    'it should render both notes without a duplicate-key console warning',
  ].join(', '),
  async () => {
    // given
    const warnings: readonly TTreeWarning[] = [
      {
        kind: 'refusal',
        activities: ['build'],
        activityRunIds: ['a80432ce_03_build'],
        stage: 'build',
        paths: [REPEATED_PATH],
        note: 'first match',
      },
      {
        kind: 'refusal',
        activities: ['build'],
        activityRunIds: ['a80432ce_03_build'],
        stage: 'build',
        paths: [REPEATED_PATH],
        note: 'second match',
      },
    ]

    // when
    const { container, messages } = await mount(warnings)
    // biome-ignore lint/plugin/no-object-mutation: restoring the real console.error before the assertions run, so a failing expectation does not swallow the runner's own reporting
    console.error = originalConsoleError

    // then
    expect(
      messages.some((message) =>
        message.includes('Encountered two children with the same key'),
      ),
    ).toBe(false)
    const text = container.textContent ?? ''
    expect(text.includes('first match')).toBe(true)
    expect(text.includes('second match')).toBe(true)
  },
)
