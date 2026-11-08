import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { Activity } from 'lucide-react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DetailSection } from './DetailSection'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mount = async (
  props: Readonly<{
    title: string
    icon?: typeof Activity
    count?: number
    open: boolean
    onToggle: () => void
  }>,
): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(
      createElement(
        DetailSection,
        props,
        createElement('p', null, 'body content'),
      ),
    )
  })
  return container
}

test(
  [
    'given DetailSection, closed, with no icon and no count',
    'when it is rendered',
    'it should show the collapsed chevron, the title, no icon, no count, and no body',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({
      title: 'Context',
      open: false,
      onToggle: () => {},
    })

    // then
    expect(container.textContent).toContain('\u25b8')
    expect(container.textContent).toContain('Context')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).not.toContain('body content')
  },
)

test(
  [
    'given DetailSection, open, with an icon and a count',
    'when it is rendered and the header is clicked',
    'it should show the expanded chevron, the icon, the count, the body, and call onToggle on click',
  ].join(', '),
  async () => {
    // given
    let toggled = 0
    const container = await mount({
      title: 'Warnings',
      icon: Activity,
      count: 3,
      open: true,
      onToggle: () => {
        toggled += 1
      },
    })

    // then — rendered state
    expect(container.textContent).toContain('\u25be')
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('(3)')
    expect(container.textContent).toContain('body content')

    // when
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state this click would trigger in a real consumer, not an await in this body
    await act(async () => {
      container.querySelector('button')?.click()
    })

    // then
    expect(toggled).toBe(1)
  },
)
