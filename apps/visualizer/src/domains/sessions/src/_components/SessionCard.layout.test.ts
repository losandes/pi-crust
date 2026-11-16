import { expect, test } from 'bun:test'
import type { Locator, Page } from 'playwright'
import {
  browserTestsEnabled,
  launchChromium,
  phoneViewport,
  startHarnessServer,
  type TViewportTier,
  viewportWidths,
} from '@/lib/testing'

/*
 * Real browser geometry verifies that the optional workspace chip and wrapped
 * stats can grow the card. happy-dom has no layout engine to measure this.
 */

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="single" style="width:100%"></div>
<div id="multi" style="width:100%"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/session-card-harness.tsx"></script>
</body></html>`

const withCards = async <T>(
  tier: TViewportTier,
  check: (page: Page) => Promise<T>,
) => {
  // Keep browser and server teardown inside each test's existing 20s budget.
  const { server, base } = await startHarnessServer()
  try {
    const activeBrowser = await launchChromium()
    try {
      const page = await activeBrowser.newPage({
        viewport: {
          width: viewportWidths[tier],
          height: phoneViewport.height,
        },
        reducedMotion: 'reduce',
      })
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(10_000)
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__diag__/index.html', (route) =>
        route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
      )
      await page.goto(`${base}/__diag__/index.html`)
      await page.waitForSelector('#single a')
      await page.waitForSelector('#multi a')
      await page.evaluate(() => document.fonts.ready)
      return await check(page)
    } finally {
      await activeBrowser.close()
    }
  } finally {
    await server.close()
  }
}

const statsClipped = (variant: 'single' | 'multi', tier: TViewportTier) =>
  withCards(tier, (page) =>
    page.$eval(`#${variant} a`, (card) => {
      const stats = card.querySelector('[data-testid="session-stats"]')
      if (!stats) return { hasStats: false, clipped: false }
      const bounds = card.getBoundingClientRect()
      const chips = Array.from(stats.children)
      return {
        hasStats: true,
        clipped: stats.getBoundingClientRect().bottom > bounds.bottom + 0.5,
        fillsViewport: Math.abs(bounds.width - window.innerWidth) <= 1,
        values: chips.map((chip) => chip.textContent?.trim()),
        chipsInside: chips.every((chip) => {
          const rect = chip.getBoundingClientRect()
          return (
            rect.top >= bounds.top - 0.5 &&
            rect.bottom <= bounds.bottom + 0.5 &&
            rect.left >= bounds.left - 0.5 &&
            rect.right <= bounds.right + 0.5
          )
        }),
      }
    }),
  )

for (const tier of ['base', 'xl'] as const) {
  for (const variant of ['single', 'multi'] as const) {
    test.skipIf(!browserTestsEnabled)(
      [
        `given a ${variant}-workspace card at the ${tier} tier`,
        'when measuring the stats row in a viewport-wide harness',
        'it should keep the stats inside the card with or without a workspace chip',
      ].join(', '),
      async () => {
        // given
        const workspace = variant

        // when
        const result = await statsClipped(workspace, tier)

        // then
        expect(result.hasStats).toBe(true)
        expect(result.clipped).toBe(false)
        expect(result.fillsViewport).toBe(true)
        expect(result.values).toEqual(['$0.4200', '1m 00s', '12.3k'])
        expect(result.chipsInside).toBe(true)
      },
      20_000,
    )
  }
}

const cardLayout = async (card: Locator) => {
  // Container-query reflow can finish after the parent width write.
  await card.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  const bounds = await card.boundingBox()
  const status = await card.getByText('success', { exact: true }).boundingBox()
  const startedAt = await card.getByText(/\d{1,2}:\d{2}:\d{2}/).boundingBox()
  if (!(bounds && status && startedAt)) {
    throw new Error('Missing card, status or start date in the layout fixture')
  }
  return {
    width: bounds.width,
    height: bounds.height,
    statusRight: status.x + status.width - bounds.x,
    statusTop: status.y - bounds.y,
    statusBottom: status.y + status.height - bounds.y,
    startedAtLeft: startedAt.x - bounds.x,
    startedAtTop: startedAt.y - bounds.y,
    startedAtRight: startedAt.x + startedAt.width - bounds.x,
    startedAtBottom: startedAt.y + startedAt.height - bounds.y,
  }
}

for (const variant of ['single', 'multi'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given issue #88's ${variant}-workspace card at the xl tier`,
      'when its parent narrows before the viewport changes to base',
      'it should grow intrinsically and reflow from the parent width, not the viewport',
    ].join(', '),
    async () => {
      // given — issue #88, requirements 1.3.1 and 1.3.6
      await withCards('xl', async (page) => {
        const parent = page.locator(`#${variant}`)
        const card = parent.getByRole('link')
        const wide = await cardLayout(card)

        // when
        await parent.evaluate(
          (element, width) =>
            element.setAttribute('style', `width:100%;max-width:${width}px`),
          viewportWidths.base,
        )
        const narrowAtXl = await cardLayout(card)
        await page.setViewportSize({
          width: viewportWidths.base,
          height: phoneViewport.height,
        })
        const narrowAtBase = await cardLayout(card)

        // then
        expect(narrowAtXl.width).toBe(viewportWidths.base)
        expect(narrowAtXl).toEqual(narrowAtBase)
        expect(narrowAtXl.height).toBeGreaterThan(wide.height)
        expect(narrowAtXl.startedAtRight).toBeLessThanOrEqual(narrowAtXl.width)
        expect(wide.startedAtLeft).toBeGreaterThan(wide.statusRight)
        expect(wide.startedAtTop).toBeLessThan(wide.statusBottom)
        expect(wide.startedAtBottom).toBeGreaterThan(wide.statusTop)
      })
    },
    20_000,
  )
}
