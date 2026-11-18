import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailSection } from './DetailSection'

for (const { name, open, count, trailing, fragment } of [
  {
    name: 'a closed section with a count and trailing content',
    open: false,
    count: 2,
    trailing: createElement('span', { id: 'slot' }, 'T'),
    fragment: '(2)</span><span id="slot">T</span></button>',
  },
  {
    name: 'an open section with a count and trailing content',
    open: true,
    count: 2,
    trailing: createElement('span', { id: 'slot' }, 'T'),
    fragment: '(2)</span><span id="slot">T</span></button>',
  },
  {
    name: 'a closed section without a count and with trailing content',
    open: false,
    count: undefined,
    trailing: createElement('span', { id: 'slot' }, 'T'),
    fragment: 'Warnings</span><span id="slot">T</span></button>',
  },
  {
    name: 'a closed section with a count and no trailing content',
    open: false,
    count: 2,
    trailing: undefined,
    fragment: '(2)</span></button>',
  },
]) {
  test(
    [
      `given ${name}`,
      'when DetailSection renders',
      'it should keep trailing content last in the header and show the body only when open',
    ].join(', '),
    () => {
      // given
      const body = 'Section body'

      // when
      const markup = renderToStaticMarkup(
        createElement(
          DetailSection,
          { title: 'Warnings', count, trailing, open, onToggle: () => {} },
          body,
        ),
      )

      // then
      expect(markup).toContain(fragment)
      expect(markup.includes(body)).toBe(open)
    },
  )
}
