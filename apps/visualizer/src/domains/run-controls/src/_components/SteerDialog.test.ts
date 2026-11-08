import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SteerDialog } from './SteerDialog'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mount = () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return { container, root }
}

const render = (
  root: ReturnType<typeof mount>['root'],
  props: Readonly<{
    open: boolean
    activity: string
    replaying: readonly string[]
    note: string
    branchReady: boolean
    onChoose: (target: 'overwrite' | 'branch') => void
    onCancel: () => void
  }>,
) =>
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  act(async () => {
    root.render(createElement(SteerDialog, props))
  })

test(
  [
    'given SteerDialog rendered with open set to true',
    'when its open prop later flips to false',
    'it should open the native dialog on mount, then close it',
  ].join(', '),
  async () => {
    // given
    const { container, root } = mount()
    await render(root, {
      open: true,
      activity: 'build',
      replaying: ['plan', 'build'],
      note: 'try again',
      branchReady: true,
      onChoose: () => {},
      onCancel: () => {},
    })
    expect(container.querySelector('dialog')?.open).toBe(true)
    expect(container.textContent).toContain('2 activitys will run again')
    expect(container.textContent).toContain('plan \u2192 build')
    expect(container.textContent).toContain('try again')

    // when
    await render(root, {
      open: false,
      activity: 'build',
      replaying: ['plan', 'build'],
      note: 'try again',
      branchReady: true,
      onChoose: () => {},
      onCancel: () => {},
    })

    // then
    expect(container.querySelector('dialog')?.open).toBe(false)
  },
)

test(
  [
    'given SteerDialog with exactly one activity to replay',
    'when it is rendered',
    'it should use the singular "activity", not "activitys"',
  ].join(', '),
  async () => {
    // given, when
    const { container, root } = mount()
    await render(root, {
      open: true,
      activity: 'build',
      replaying: ['build'],
      note: '',
      branchReady: true,
      onChoose: () => {},
      onCancel: () => {},
    })

    // then
    expect(container.textContent).toContain('1 activity will run again')
  },
)

test(
  [
    'given SteerDialog with branchReady set to false',
    'when it is rendered',
    'it should disable the branch button and explain that branching is not built yet',
  ].join(', '),
  async () => {
    // given, when
    const { container, root } = mount()
    await render(root, {
      open: true,
      activity: 'build',
      replaying: ['build'],
      note: '',
      branchReady: false,
      onChoose: () => {},
      onCancel: () => {},
    })

    // then
    const branchButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.startsWith('branch'),
    )
    expect(branchButton?.disabled).toBe(true)
    expect(container.textContent).toContain('not built yet')
  },
)

test(
  [
    'given SteerDialog, open',
    'when overwrite is chosen, or cancel is pressed, or the dialog fires its native cancel event',
    "it should call onChoose('overwrite') once and onCancel twice, suppressing the browser\u2019s own close on the native event",
  ].join(', '),
  async () => {
    // given
    const chosen: string[] = []
    let cancelled = 0
    const { container, root } = mount()
    await render(root, {
      open: true,
      activity: 'build',
      replaying: ['build'],
      note: '',
      branchReady: true,
      onChoose: (target) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one test's mock receives
        chosen.push(target)
      },
      onCancel: () => {
        cancelled += 1
      },
    })
    const overwriteButton = Array.from(
      container.querySelectorAll('button'),
    ).find((button) => button.textContent?.startsWith('overwrite'))
    const cancelButton = container.querySelector('button')

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the click would trigger in a real consumer, not an await in this body
    await act(async () => {
      overwriteButton?.click()
    })
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the click would trigger in a real consumer, not an await in this body
    await act(async () => {
      cancelButton?.click()
    })
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the native event would trigger in a real consumer, not an await in this body
    await act(async () => {
      container
        .querySelector('dialog')
        ?.dispatchEvent(new Event('cancel', { cancelable: true }))
    })

    // then
    expect(chosen).toEqual(['overwrite'])
    expect(cancelled).toBe(2)
  },
)

test(
  [
    'given SteerDialog, open and ready to branch',
    'when branch is chosen',
    "it should call onChoose('branch')",
  ].join(', '),
  async () => {
    // given
    const chosen: string[] = []
    const { container, root } = mount()
    await render(root, {
      open: true,
      activity: 'build',
      replaying: ['build'],
      note: '',
      branchReady: true,
      onChoose: (target) => {
        // biome-ignore lint/plugin/no-array-mutation: accumulating what this one test's mock receives
        chosen.push(target)
      },
      onCancel: () => {},
    })
    const branchButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.startsWith('branch'),
    )

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the click would trigger in a real consumer, not an await in this body
    await act(async () => {
      branchButton?.click()
    })

    // then
    expect(chosen).toEqual(['branch'])
  },
)
