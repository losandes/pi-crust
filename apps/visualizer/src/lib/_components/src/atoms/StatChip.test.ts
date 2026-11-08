import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { StatChip } from './StatChip'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mount = async (
  props: Readonly<{
    kind: 'cost' | 'tokens' | 'runtime' | 'read' | 'written'
    value: number | undefined
    compact?: boolean
  }>,
): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(createElement(StatChip, props))
  })
  return container
}

test(
  [
    'given StatChip for kind "cost"',
    'when it is rendered',
    'it should format the value as money and carry the cost explanation as its title',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({ kind: 'cost', value: 1.5 })

    // then
    const span = container.querySelector('span')
    expect(span?.getAttribute('title')).toContain('Cost')
    expect(container.textContent ?? '').toContain('$1.50')
  },
)

test(
  [
    'given StatChip for kind "runtime"',
    'when the value is undefined',
    'it should still render, formatting NaN rather than throwing',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({ kind: 'runtime', value: undefined })

    // then
    expect(container.querySelector('span')).not.toBeNull()
  },
)

test(
  [
    'given StatChip for kind "tokens", "read" and "written"',
    'when each is rendered compact',
    'it should size its icon for the tighter compact layout and carry that kind\u2019s explanation',
  ].join(', '),
  async () => {
    for (const kind of ['tokens', 'read', 'written'] as const) {
      // given, when
      const container = await mount({ kind, value: 42, compact: true })

      // then
      const span = container.querySelector('span')
      expect(span?.getAttribute('title') ?? '').toContain(
        kind === 'tokens' ? 'Tokens' : kind === 'read' ? 'Read' : 'Written',
      )
      const icon = container.querySelector('svg')
      expect(icon?.getAttribute('width')).toBe('17')
    }
  },
)
