import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmDialog } from './ConfirmDialog'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mount = async (
  props: Readonly<{
    open: boolean
    title: string
    body: string
    confirmLabel: string
    cancelLabel?: string
    onConfirm: () => void
    onCancel: () => void
  }>,
): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(createElement(ConfirmDialog, props))
  })
  return container
}

test(
  [
    'given ConfirmDialog with open set to true',
    'when it is mounted',
    'it should open the native dialog and show the given title, body and confirm label',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({
      open: true,
      title: 'abort this run?',
      body: 'whatever the current activity has done goes with it',
      confirmLabel: 'abort the run',
      onConfirm: () => {},
      onCancel: () => {},
    })

    // then
    const dialog = container.querySelector('dialog')
    expect(dialog?.open).toBe(true)
    expect(container.textContent).toContain('abort this run?')
    expect(container.textContent).toContain(
      'whatever the current activity has done goes with it',
    )
    expect(container.textContent).toContain('abort the run')
    expect(container.textContent).toContain('cancel')
  },
)

test(
  [
    'given ConfirmDialog',
    'when the confirm button is pressed',
    'it should call onConfirm',
  ].join(', '),
  async () => {
    // given
    let confirmed = 0
    const container = await mount({
      open: true,
      title: 'abort this run?',
      body: 'body',
      confirmLabel: 'abort the run',
      onConfirm: () => {
        confirmed += 1
      },
      onCancel: () => {},
    })
    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'abort the run',
    )

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the click would trigger in a real consumer, not an await in this body
    await act(async () => {
      confirmButton?.click()
    })

    // then
    expect(confirmed).toBe(1)
  },
)

test(
  [
    'given ConfirmDialog with a custom cancel label',
    'when the cancel button is pressed, or the dialog itself fires its native cancel event',
    'it should call onCancel both times, without ever calling onConfirm',
  ].join(', '),
  async () => {
    // given
    let cancelled = 0
    let confirmed = 0
    const container = await mount({
      open: true,
      title: 'discard this draft?',
      body: 'body',
      confirmLabel: 'discard',
      cancelLabel: 'keep editing',
      onConfirm: () => {
        confirmed += 1
      },
      onCancel: () => {
        cancelled += 1
      },
    })
    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'keep editing',
    )

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the click would trigger in a real consumer, not an await in this body
    await act(async () => {
      cancelButton?.click()
    })
    // and — Escape fires the dialog's native `cancel` event without React
    // ever seeing a click; the component must still hear it and suppress the
    // browser's own default (which would otherwise close the dialog without
    // telling the caller that opened it)
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the event would trigger in a real consumer, not an await in this body
    await act(async () => {
      container
        .querySelector('dialog')
        ?.dispatchEvent(new Event('cancel', { cancelable: true }))
    })

    // then
    expect(cancelled).toBe(2)
    expect(confirmed).toBe(0)
  },
)

test(
  [
    'given a mounted ConfirmDialog',
    'when its `open` prop flips from true to false',
    'it should close the native dialog element',
  ].join(', '),
  async () => {
    // given
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const render = (open: boolean) =>
      // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
      act(async () => {
        root.render(
          createElement(ConfirmDialog, {
            open,
            title: 't',
            body: 'b',
            confirmLabel: 'c',
            onConfirm: () => {},
            onCancel: () => {},
          }),
        )
      })
    await render(true)
    expect(container.querySelector('dialog')?.open).toBe(true)

    // when
    await render(false)

    // then
    expect(container.querySelector('dialog')?.open).toBe(false)
  },
)
