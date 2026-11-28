import { expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { FilterDropdown } from './FilterDropdown'

const withDropdown = async (
  check: (
    container: HTMLDivElement,
    render: (
      props: Partial<ComponentProps<typeof FilterDropdown>>,
    ) => Promise<void>,
  ) => Promise<void>,
) => {
  GlobalRegistrator.register()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = async (
    props: Partial<ComponentProps<typeof FilterDropdown>>,
  ) => {
    await act(() =>
      root.render(
        <FilterDropdown
          label="repository"
          options={['/srv/acme/app', '/mnt/acme/app']}
          selected={[]}
          open={false}
          onOpen={() => {}}
          onToggle={() => {}}
          onSelectAll={() => {}}
          {...props}
        />,
      ),
    )
  }
  try {
    await check(container, render)
  } finally {
    await act(() => root.unmount())
    container.remove()
    await GlobalRegistrator.unregister()
  }
}

test(
  [
    'given a closed repository dropdown',
    'when opening and displaying options',
    'it should draw only explicit display titles and labels',
  ].join(', '),
  async () => {
    // given
    const opened = mock((_open: boolean) => {})
    await withDropdown(async (container, render) => {
      await render({ onOpen: opened })
      // when
      await act(() => container.querySelector('button')?.click())
      // then
      expect(opened.mock.calls.flat()).toEqual([true])
      expect(container.querySelector('input')).toBeNull()
      // when
      await render({
        open: true,
        labelOf: () => 'app',
        titleOf: (option) => `hidden:${option.slice(4)}`,
        colorOf: (option) => (option.startsWith('/srv') ? 'green' : undefined),
      })
      // then
      const options = [...container.querySelectorAll('label span')]
      expect(options.map((option) => option.textContent)).toEqual([
        'app',
        'app',
      ])
      expect(options.map((option) => option.getAttribute('title'))).toEqual([
        'hidden:/acme/app',
        'hidden:/acme/app',
      ])
      expect(
        options.every((option) =>
          option.getAttribute('style')?.includes('color'),
        ),
      ).toBe(true)
      // when
      await render({ open: true, labelOf: () => 'app' })
      // then
      expect(
        [...container.querySelectorAll('label span')].every(
          (option) => !option.hasAttribute('title'),
        ),
      ).toBe(true)
    })
  },
)

test(
  [
    'given a selected dropdown option',
    'when toggling and selecting all',
    'it should delegate selection and opening without changing identities',
  ].join(', '),
  async () => {
    // given
    const toggled = mock((_value: string) => {})
    const opened = mock((_open: boolean) => {})
    let cleared = 0
    await withDropdown(async (container, render) => {
      await render({
        open: true,
        selected: ['/srv/acme/app'],
        onToggle: toggled,
        onSelectAll: () => {
          cleared++
        },
        onOpen: opened,
      })
      // when
      await act(() =>
        container
          .querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]
          ?.click(),
      )
      await act(() =>
        container
          .querySelector<HTMLInputElement>('input[type=checkbox]')
          ?.click(),
      )
      await act(() => container.querySelector('button')?.click())
      // then
      expect(toggled.mock.calls.flat()).toEqual(['/srv/acme/app'])
      expect(cleared).toBe(1)
      expect(opened.mock.calls.flat()).toEqual([false])
      expect(container.querySelector('button')?.textContent).toBe(
        'repository · 1',
      )
      // when
      await render({
        open: true,
        onSelectAll: () => {
          cleared++
        },
      })
      await act(() =>
        container
          .querySelector<HTMLInputElement>('input[type=checkbox]')
          ?.click(),
      )
      // then
      expect(cleared).toBe(1)
    })
  },
)

test(
  [
    'given an open searchable dropdown',
    'when entering search and reopening',
    'it should narrow options and forget the search on close',
  ].join(', '),
  async () => {
    // given
    await withDropdown(async (container, render) => {
      await render({ open: true })
      const input =
        container.querySelector<HTMLInputElement>('input[type=search]')
      // when
      await act(() => {
        input?.focus()
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, 'srv')
        input?.dispatchEvent(
          new KeyboardEvent('keyup', { bubbles: true, key: 'v' }),
        )
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })
      // then
      expect(container.querySelectorAll('label span')).toHaveLength(1)
      // when
      await render({ open: false })
      await render({ open: true })
      // then
      expect(container.querySelectorAll('label span')).toHaveLength(2)
      expect(
        container.querySelector<HTMLInputElement>('input[type=search]')?.value,
      ).toBe('')
    })
  },
)
