import { afterAll, expect, test } from 'bun:test'
import type { Locator, Page } from 'playwright'
import {
  browserTestsEnabled,
  closeBrowserSuite,
  openBrowserSuite,
  phoneViewport,
  type TViewportTier,
  viewportWidths,
  withSuitePage,
} from '@/lib/testing'

/*
 * Real browser geometry verifies that the branch chip and wrapped
 * stats can grow the card. happy-dom has no layout engine to measure this.
 */

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="single" style="width:100%"></div>
<div id="multi" style="width:100%"></div>
<div id="unrecorded" style="width:100%"></div>
<div id="long" style="width:100%"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/session-card-harness.tsx"></script>
</body></html>`

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one browser and dev server per file; each test opens its own context
afterAll(() => closeBrowserSuite(suite), 30_000)

const withCards = <T>(
  tier: TViewportTier,
  check: (page: Page) => Promise<T>,
) => {
  return withSuitePage(suite)(
    {
      viewport: {
        width: viewportWidths[tier],
        height: phoneViewport.height,
      },
      reducedMotion: 'reduce',
    },
    async (page, { base }) => {
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(10_000)
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__diag__/index.html', (route) =>
        route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
      )
      await page.goto(`${base}/__diag__/index.html`)
      await page.waitForSelector('#single a')
      await page.waitForSelector('#multi a')
      await page.waitForSelector('#unrecorded a')
      await page.waitForSelector('#long a')
      await page.evaluate(() => document.fonts.ready)
      return await check(page)
    },
  )
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
        'it should keep the stats inside the card with its branch chip',
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

test.skipIf(!browserTestsEnabled)(
  [
    'given a single-tree card at the base tier',
    'when its branch renders',
    'it should show main below the run identifier and repository',
  ].join(', '),
  async () => {
    // given
    await withCards('base', async (page) => {
      const card = page.locator('#single a')

      // when
      const origin = card.getByTestId('session-repository')
      expect(await origin.textContent()).toBe('alpha')
      expect(
        await origin.evaluate((element) =>
          element.nextElementSibling?.getAttribute('data-testid'),
        ),
      ).toBe('session-branch')
      const branch = card.getByTestId('session-branch')
      const position = await branch.evaluate((element) => {
        const identifier =
          element.previousElementSibling?.previousElementSibling
        if (!identifier) throw new Error('Missing run identifier')
        return {
          identifier: identifier.textContent?.trim(),
          below:
            element.getBoundingClientRect().top >=
            identifier.getBoundingClientRect().bottom - 0.5,
        }
      })

      // then
      expect(await branch.count()).toBe(1)
      expect(await branch.textContent()).toBe('main')
      expect(position).toEqual({ identifier: 'run-diag-1', below: true })
    })
  },
  20_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given a card with no recorded branch at the base tier',
    'when its branch label renders',
    'it should show exactly one visible working-tree name',
  ].join(', '),
  async () => {
    // given
    await withCards('base', async (page) => {
      const card = page.locator('#unrecorded a')

      // when
      const branch = card.getByTestId('session-branch')
      const bounds = await branch.boundingBox()

      // then
      expect(await branch.count()).toBe(1)
      expect(await branch.textContent()).toBe('a')
      const origin = card.getByTestId('session-repository')
      expect(await origin.textContent()).toBe('unknown')
      expect(await origin.getAttribute('title')).toBe('repository not recorded')
      expect(
        await origin.evaluate((element) =>
          element.nextElementSibling?.getAttribute('data-testid'),
        ),
      ).toBe('session-branch')
      expect(bounds?.width).toBeGreaterThan(0)
    })
  },
  20_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given a multi-tree card at the base tier',
    'when hovering its branch label',
    'it should retain the working-tree path as its title',
  ].join(', '),
  async () => {
    // given
    await withCards('base', async (page) => {
      // when
      const branch = page.locator('#multi a').getByTestId('session-branch')
      await branch.hover()

      // then
      expect(await branch.getAttribute('title')).toBe('/repo/a')
    })
  },
  20_000,
)

// No rendered component varies at sm, md, lg or xl; the card and its children
// have no responsive variants or breakpoint media queries. Keep both endpoints.
for (const tier of ['base', '2xl'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given a 120-character branch card at the ${tier} tier`,
      'when measuring the branch chip',
      'it should stay inside the card without horizontal document overflow',
    ].join(', '),
    async () => {
      // given
      await withCards(tier, async (page) => {
        // when
        const layout = await page.locator('#long a').evaluate((card) => {
          const branch = card.querySelector('[data-testid="session-branch"]')
          if (!branch) throw new Error('Missing branch chip')
          const bounds = card.getBoundingClientRect()
          const rect = branch.getBoundingClientRect()
          return {
            length: branch.textContent?.length,
            inside:
              rect.top >= bounds.top - 0.5 &&
              rect.bottom <= bounds.bottom + 0.5 &&
              rect.left >= bounds.left - 0.5 &&
              rect.right <= bounds.right + 0.5,
            truncated: branch.scrollWidth > branch.clientWidth,
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }
        })

        // then
        expect(layout.length).toBe(120)
        expect(layout.inside).toBe(true)
        expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)
        if (tier === 'base') expect(layout.truncated).toBe(true)
      })
    },
    20_000,
  )
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
