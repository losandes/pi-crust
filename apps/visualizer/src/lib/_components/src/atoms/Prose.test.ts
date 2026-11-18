import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Prose } from './Prose'

for (const { variant, classes } of [
  {
    variant: 'default',
    classes: [
      'text-base/relaxed',
      '[&_h1]:text-xl',
      '[&_pre.md-code]:whitespace-pre',
    ],
  },
  {
    variant: 'compact',
    classes: ['text-sm/normal', '[&_h1]:text-base', '[&_h1]:text-waiting'],
  },
] as const) {
  test(
    [
      `given the ${variant} Prose variant`,
      'when rendered with escaped markdown HTML',
      'it should inject the HTML in one div with its typography and shared table classes',
    ].join(', '),
    () => {
      // given
      const html =
        '<h1>Question</h1><p>Keep &lt;input&gt; escaped.</p><table class="md-table"><tbody><tr><td>Answer</td></tr></tbody></table>'

      // when
      const markup = renderToStaticMarkup(
        createElement(Prose, { html, variant }),
      )

      // then
      expect(markup).toContain(`>${html}</div>`)
      expect(markup.match(/<div\b/g)).toHaveLength(1)
      for (const className of classes)
        expect(markup).toContain(className.replaceAll('&', '&amp;'))
      expect(markup).toContain('[&amp;_table.md-table]:w-full!')
      expect(markup).toContain(
        '[&amp;_table.md-table_tbody_tr:nth-child(even)]:bg-zebra!',
      )
    },
  )
}

test(
  [
    'given Prose without a variant',
    'when rendering an empty document',
    'it should use the default variant without adding content or wrappers',
  ].join(', '),
  () => {
    // given
    const html = ''

    // when
    const markup = renderToStaticMarkup(createElement(Prose, { html }))
    const explicit = renderToStaticMarkup(
      createElement(Prose, { html, variant: 'default' }),
    )

    // then
    expect(markup).toBe(explicit)
    expect(markup).toEndWith('></div>')
  },
)
