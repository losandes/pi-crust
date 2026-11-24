import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TOKEN_KEY } from '@/lib/api-client'
import { TokenNotice } from './TokenNotice'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const mount = async (
  props: Readonly<{ problem: string; onSaved: () => void }>,
): Promise<HTMLDivElement> => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // biome-ignore lint/suspicious/useAwait: act's own scheduling, not an await in this body, is what flushes the render this mount triggers
  await act(async () => {
    root.render(createElement(TokenNotice, props))
  })
  return container
}

/**
 * Calls the `onChange` React registered on this input directly, the same
 * handler a real keystroke would call — dispatching a native `input` event
 * does not reach it under happy-dom + React 19 in this test environment.
 */
const typeInto = async (element: Element, value: string): Promise<void> => {
  const propsKey = Object.keys(element).find((key) =>
    key.startsWith('__reactProps$'),
  )
  expect(propsKey).toBeDefined()
  const onChange = (element as unknown as Record<string, unknown>)[
    propsKey as string
  ] as Readonly<{ onChange: (event: unknown) => void }>
  // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state update the handler triggers, not an await in this body
  await act(async () => {
    onChange.onChange({ target: { value } })
  })
}

test(
  [
    'given TokenNotice',
    'when there is no problem to report',
    'it should render nothing',
  ].join(', '),
  async () => {
    // given, when
    const container = await mount({ problem: '', onSaved: () => {} })

    // then
    expect(container.innerHTML).toBe('')
  },
)

test(
  [
    'given TokenNotice with a problem to report',
    'when a token is typed in and the form is submitted',
    'it should save the token to localStorage and call onSaved',
  ].join(', '),
  async () => {
    // given
    window.localStorage.removeItem(TOKEN_KEY)
    let saved = 0
    const container = await mount({
      problem: 'That token was not accepted.',
      onSaved: () => {
        saved += 1
      },
    })
    expect(container.textContent).toContain('That token was not accepted.')
    expect(container.textContent).toContain('CRUST_TOKEN=… crust observe')

    // when
    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    await typeInto(input as Element, 'new-token-value')
    // biome-ignore lint/suspicious/useAwait: act's own scheduling flushes the state the submit handler triggers, not an await in this body
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        )
    })

    // then
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('new-token-value')
    expect(saved).toBe(1)
  },
)
