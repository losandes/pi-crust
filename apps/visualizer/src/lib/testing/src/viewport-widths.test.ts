import { expect, test } from 'bun:test'
import { devices } from 'playwright'
import { viewportWidths } from './viewport-widths'

test(
  [
    'given browser-test viewport widths',
    'when their tier names are read',
    'it should expose the base tier followed by the default Tailwind scale',
  ].join(', '),
  () => {
    // given
    const widths = viewportWidths

    // when
    const tiers = Object.keys(widths)

    // then
    expect(tiers).toEqual(['base', 'sm', 'md', 'lg', 'xl', '2xl'])
  },
)

test(
  [
    'given the base viewport tier',
    'when its width is read',
    'it should use the Playwright small-phone descriptor',
  ].join(', '),
  () => {
    // given
    const phone = devices['iPhone SE']

    // when
    const width = viewportWidths.base

    // then
    expect(width).toBe(phone.viewport.width)
  },
)

test(
  [
    'given the default viewport tiers',
    'when their widths are compared in order',
    'it should provide finite increasing widths above the small-phone base',
  ].join(', '),
  () => {
    // given
    const widths = Object.values(viewportWidths)

    // when
    const increasing = widths.every(
      (width, index) =>
        Number.isFinite(width) && width > (widths[index - 1] ?? 0),
    )

    // then
    expect(increasing).toBe(true)
  },
)
