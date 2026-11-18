import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ErrorBar } from './ErrorBar'

test(
  [
    'given an error message containing HTML',
    'when ErrorBar renders',
    'it should escape the message inside exactly one div',
  ].join(', '),
  () => {
    // given
    const message = '<script>unsafe & untrusted</script>'

    // when
    const markup = renderToStaticMarkup(createElement(ErrorBar, { message }))

    // then
    expect(markup.match(/<div\b/g)).toHaveLength(1)
    expect(markup).toEndWith(
      '>&lt;script&gt;unsafe &amp; untrusted&lt;/script&gt;</div>',
    )
  },
)

test(
  [
    'given ErrorBar placements',
    'when rendered',
    'it should never emit an important utility',
  ].join(', '),
  () => {
    // given
    const message = 'An error'

    // when
    const markup = ([undefined, 'page', 'panel'] as const).map((placement) =>
      renderToStaticMarkup(createElement(ErrorBar, { message, placement })),
    )

    // then
    expect(markup.every((html) => !html.includes('!'))).toBe(true)
  },
)

for (const { placement, expected, absent } of [
  {
    placement: undefined,
    expected: ['mx-6', 'my-3'],
    absent: ['mx-4.5', 'mt-3.5', 'mb-0'],
  },
  {
    placement: 'panel',
    expected: ['mx-4.5', 'mt-3.5', 'mb-0'],
    absent: ['mx-6', 'my-3'],
  },
] as const) {
  test(
    [
      `given ErrorBar with ${placement ?? 'default'} placement`,
      'when rendered',
      'it should select only the placement utilities without important classes',
    ].join(', '),
    () => {
      // given
      const message = 'An error'

      // when
      const markup = renderToStaticMarkup(
        createElement(ErrorBar, { message, placement }),
      )
      const classes = markup.match(/class="([^"]*)"/)?.[1]?.split(' ') ?? []

      // then
      for (const name of expected) expect(classes).toContain(name)
      for (const name of absent) expect(classes).not.toContain(name)
      expect(classes.some((name) => name.includes('!'))).toBe(false)
    },
  )
}
