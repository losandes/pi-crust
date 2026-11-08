import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { TTreeWarning } from '../usecases/warnings'
import { TreeWarnings } from './TreeWarnings'

/**
 * `TreeWarnings.test.ts` already proves the single-group duplicate-path and
 * duplicate-warning cases the issue reported. This file covers what that one
 * does not: the same collision across more than one of the four kind groups
 * the component renders separately, so the fix is shown to hold across the
 * whole `KINDS.map` loop and not only the `group.map` loop it was written
 * against.
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

const SHARED_PATH = 'warn read of node_modules by bash (matched twice)'

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
    'when separate kind groups each contain a warning repeating the same path',
    'it should render every group without a duplicate-key console warning',
  ].join(', '),
  async () => {
    // given
    const warnings: readonly TTreeWarning[] = [
      {
        kind: 'unexpected',
        activities: ['build'],
        activityRunIds: ['run_01'],
        stage: 'build',
        paths: [SHARED_PATH, SHARED_PATH],
        note: '',
      },
      {
        kind: 'overstep',
        activities: ['build'],
        activityRunIds: ['run_01'],
        stage: 'build',
        paths: [SHARED_PATH, SHARED_PATH],
        note: '',
      },
      {
        kind: 'refusal',
        activities: ['build'],
        activityRunIds: ['run_01'],
        stage: 'build',
        paths: [SHARED_PATH, SHARED_PATH],
        note: '',
      },
      {
        kind: 'uncommitted',
        activities: ['build'],
        activityRunIds: ['run_01'],
        stage: 'build',
        paths: [SHARED_PATH, SHARED_PATH],
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
    const sections = container.querySelectorAll('section')
    expect(sections.length).toBe(4)
    for (const section of Array.from(sections)) {
      expect(section.querySelectorAll('li').length).toBe(2)
    }
  },
)
