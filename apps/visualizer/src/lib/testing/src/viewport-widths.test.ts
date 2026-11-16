import { expect, test } from 'bun:test'
import { integrationTestsEnabled } from './integration'
import { phoneViewport, viewportWidths } from './viewport-widths'

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

test.skipIf(!integrationTestsEnabled)(
  [
    'given the base viewport tier',
    'when its width is read',
    'it should use the Playwright small-phone descriptor',
  ].join(', '),
  async () => {
    // given
    const phone = (await import('playwright')).devices['iPhone SE']

    // when
    const viewport = phoneViewport

    // then
    expect(viewport).toEqual<typeof phone.viewport>(phone.viewport)
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
