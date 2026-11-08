import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { StatusChip } from './StatusChip'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mount = async (status: string): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(createElement(StatusChip, { status }))
  })
  return container
}

test(
  [
    'given StatusChip',
    'when the status is one of the five named statuses',
    'it should render that status\u2019s icon and tone class, and the status text',
  ].join(', '),
  async () => {
    for (const status of [
      'success',
      'fail',
      'running',
      'queued',
      'waiting',
      'superseded',
    ]) {
      // given, when
      const container = await mount(status)

      // then
      const span = container.querySelector('span')
      expect(span?.textContent).toContain(status)
      expect(container.querySelector('svg')).not.toBeNull()
    }
  },
)

test(
  [
    'given StatusChip',
    'when the status is not one of the named statuses',
    'it should fall back to the generic circle icon rather than throwing or rendering none',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount('archived')

    // then
    const span = container.querySelector('span')
    expect(span?.textContent).toContain('archived')
    expect(container.querySelector('svg')).not.toBeNull()
  },
)
