import { afterAll, expect, test } from 'bun:test'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  closeBrowserSuite,
  openBrowserSuite,
  phoneViewport,
  settleTransitions,
  type TViewportTier,
  viewportWidths,
  withSuitePage,
} from '@/lib/testing'

const themes = [
  { name: 'dark', label: 'Dark', system: 'dark' },
  { name: 'light', label: 'Light', system: 'dark' },
  { name: 'auto-dark', label: 'Auto', system: 'dark' },
  { name: 'auto-light', label: 'Auto', system: 'light' },
  { name: 'registered', label: 'High contrast', system: 'dark' },
] as const

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one Chromium and Vite server; each case has isolated storage and routes
afterAll(() => closeBrowserSuite(suite), 30_000)

const pageGeometry = async (page: Page) => {
  await settleTransitions(page)
  return page.evaluate(() => ({
    width: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
    viewport: document.documentElement.clientWidth,
  }))
}

const expectPageFits = async (page: Page, context: string) => {
  const geometry = await pageGeometry(page)
  expect(geometry.width, context).toBeLessThanOrEqual(geometry.viewport + 1)
}

const withSessionPage = (
  kind: 'dashboard' | 'trace',
  tier: TViewportTier,
  theme: (typeof themes)[number],
  check: (page: Page, context: string) => Promise<void>,
) =>
  withSuitePage(suite)(
    {
      viewport: { width: viewportWidths[tier], height: phoneViewport.height },
      colorScheme: theme.system,
      reducedMotion: 'reduce',
    },
    async (page, { server, base }) => {
      page.setDefaultTimeout(10_000)
      const fixture = kind === 'dashboard' ? 'sessions-list' : 'session-trace'
      const path = `/__whole-page-${kind}__/index.html`
      await page.route('**/api/**', (route) => route.abort())
      await page.route(`**${path}*`, async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            path,
            `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="app"></div><script type="module" src="/src/domains/sessions/src/_components/__fixtures__/${fixture}-harness.tsx"></script></body></html>`,
          ),
        }),
      )
      await page.goto(`${base}${path}?overflow`)
      if (kind === 'dashboard') {
        await page.waitForFunction(
          () =>
            document.querySelectorAll('main a[href*="dashboard-"]').length ===
            4,
        )
      } else {
        await page.locator('button[title^="build — running"]').waitFor()
        await page
          .getByRole('heading', { name: 'unexplained changes' })
          .waitFor()
      }
      await page.getByRole('button', { name: /^Theme:/ }).click()
      await page.getByRole('option', { name: theme.label, exact: true }).click()
      await page.evaluate(() => document.fonts.ready)
      await settleTransitions(page)
      const context = `${kind}, ${tier}, ${theme.name}`
      const applied = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        border: getComputedStyle(document.documentElement)
          .getPropertyValue('--border-width')
          .trim(),
      }))
      expect(applied.theme, context).toBe(
        theme.name === 'registered'
          ? 'high-contrast'
          : theme.name.startsWith('auto-')
            ? theme.system
            : theme.name,
      )
      expect(applied.border, context).toBe(
        theme.name === 'registered' ? '2px' : '1px',
      )
      await check(page, context)
    },
  )

test.skipIf(!browserTestsEnabled)(
  [
    'given the dashboard in the app shell at the base tier',
    'when an element wider than the viewport is inserted among the session cards',
    'it should measure the page as wider than the viewport',
  ].join(', '),
  async () => {
    // given
    await withSessionPage(
      'dashboard',
      'base',
      themes[0],
      async (page, context) => {
        await expectPageFits(page, context)

        // when
        await page
          .locator('main a[href*="dashboard-"]')
          .first()
          .locator('..')
          .evaluate((grid) => {
            grid.insertAdjacentHTML(
              'beforeend',
              '<div style="min-width:200vw;height:1px"></div>',
            )
          })

        // then
        const geometry = await pageGeometry(page)
        expect(geometry.width, context).toBeGreaterThan(geometry.viewport + 1)
      },
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given the trace in the app shell at the base tier with the detail panel open',
    'when an element wider than the viewport is inserted in the panel header',
    'it should measure the page as wider than the viewport',
  ].join(', '),
  async () => {
    // given
    await withSessionPage('trace', 'base', themes[0], async (page, context) => {
      await page.locator('button[title^="build — running"]').click()
      const tablist = page.getByRole('tablist', { name: 'activity detail' })
      await tablist.waitFor()
      const detail = page.locator('section').filter({ has: tablist })
      await expectPageFits(page, context)

      // when
      await detail.locator(':scope > header').evaluate((header) => {
        header.insertAdjacentHTML(
          'beforeend',
          '<div style="min-width:200vw;height:1px"></div>',
        )
      })

      // then
      const geometry = await pageGeometry(page)
      expect(geometry.width, context).toBeGreaterThan(geometry.viewport + 1)
    })
  },
  30_000,
)

for (const tier of Object.keys(viewportWidths) as TViewportTier[]) {
  for (const theme of themes) {
    test.skipIf(!browserTestsEnabled)(
      [
        `given the dashboard in the app shell at the ${tier} tier under the ${theme.name} theme`,
        'when four sessions with long identifiers render',
        'it should not scroll sideways',
      ].join(', '),
      async () => {
        // given
        await withSessionPage(
          'dashboard',
          tier,
          theme,
          async (page, context) => {
            // when
            await page
              .locator('main')
              .getByText(/unbroken-identifier-/)
              .filter({ visible: true })
              .first()
              .waitFor()

            // then
            await expectPageFits(page, context)
          },
        )
      },
      30_000,
    )

    test.skipIf(!browserTestsEnabled)(
      [
        `given the trace in the app shell at the ${tier} tier under the ${theme.name} theme`,
        'when no activity is selected and then each detail tab is selected',
        'it should not scroll sideways in any state',
      ].join(', '),
      async () => {
        // given
        await withSessionPage('trace', tier, theme, async (page, context) => {
          // when, then
          const tablist = page.getByRole('tablist', { name: 'activity detail' })
          expect(await tablist.count()).toBe(0)
          await page
            .locator('main')
            .getByText(/unbroken-identifier-|long-directory\//)
            .filter({ visible: true })
            .first()
            .waitFor()
          await expectPageFits(page, `${context}, no selection`)
          await page.locator('button[title^="build — running"]').click()
          await tablist.waitFor()
          const tabs = tablist.getByRole('tab')
          const detail = page.locator('section').filter({ has: tablist })
          expect(await tabs.count(), context).toBe(4)
          for (const label of ['chat', 'highlights', 'context', 'events']) {
            // when
            const tab = tablist.getByRole('tab', {
              name: new RegExp(`^${label}\\b`, 'i'),
            })
            await tab.click()
            if (label === 'context') {
              await detail.getByRole('button', { name: /agent config/ }).click()
            }

            // then
            expect(
              await tab.getAttribute('aria-selected'),
              `${context}, ${label}`,
            ).toBe('true')
            await detail
              .getByText(/unbroken-identifier-|long-directory\//)
              .filter({ visible: true })
              .first()
              .waitFor()
            await expectPageFits(page, `${context}, ${label}`)
          }
        })
      },
      30_000,
    )
  }
}
