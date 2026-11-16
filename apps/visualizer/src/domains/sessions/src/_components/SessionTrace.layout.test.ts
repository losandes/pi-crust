import { afterAll, expect, test } from 'bun:test'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  closeBrowserSuite,
  openBrowserSuite,
  phoneViewport,
  type TViewportTier,
  viewportWidths,
  withSuitePage,
} from '@/lib/testing'

const HARNESS_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="app"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/session-trace-harness.tsx"></script>
</body></html>`

const TRACE = 'main > div'
const WATERFALL = `${TRACE} > div:nth-child(2)`
const RUNNING_BLOCK = 'button[title^="build — running"]'

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one browser and dev server per file; each test opens its own context
afterAll(() => closeBrowserSuite(suite), 30_000)

const withTrace = (
  tier: TViewportTier,
  check: (page: Page) => Promise<void>,
  status = 'waiting',
  state: 'populated' | 'error' | 'empty' | 'loading' = 'populated',
) => {
  return withSuitePage(suite)(
    {
      viewport: {
        width: viewportWidths[tier],
        height: phoneViewport.height,
      },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    },
    async (page, { server, base }) => {
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(10_000)
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__trace__/index.html*', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__trace__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(
        `${base}/__trace__/index.html?status=${status}&state=${state}#/fixture:trace-layout`,
      )
      const ready = {
        populated: page.locator(RUNNING_BLOCK),
        error: page.getByText(/^api unreachable — retrying/),
        empty: page.getByText('no activityRuns recorded for this session', {
          exact: true,
        }),
        loading: page.getByText('loading trace…', { exact: true }),
      }[state]
      await ready.waitFor()
      if (state === 'populated' || state === 'empty') {
        await page
          .getByRole('heading', { name: 'unexplained changes' })
          .waitFor()
        if (status === 'waiting') {
          await page
            .getByRole('region', { name: 'what this run is asking' })
            .waitFor()
        }
      }
      await page.evaluate(() => document.fonts.ready)
      await check(page)
    },
  )
}

for (const { tier, columns, below } of [
  { tier: 'base', columns: 1, below: false },
  { tier: 'md', columns: 1, below: true },
  { tier: 'md', columns: 2, below: false },
] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given the trace ${below ? 'immediately below' : 'at'} the ${tier} tier with its real child panels`,
      'when the waterfall is measured in Chromium',
      `it should use ${columns} columns without horizontal document overflow`,
    ].join(', '),
    async () => {
      // given
      await withTrace(tier, async (page) => {
        // when
        if (below) {
          await page.setViewportSize({
            width: viewportWidths[tier] - 1,
            height: phoneViewport.height,
          })
        }
        const layout = await page
          .locator(`${WATERFALL} > div`)
          .evaluateAll((rows) => ({
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            rows: rows.map((row) => {
              const label = row.children[0]?.getBoundingClientRect()
              const track = row.children[1]?.getBoundingClientRect()
              if (!(label && track))
                throw new Error('Missing waterfall label or track')
              return {
                columns:
                  getComputedStyle(row).gridTemplateColumns.split(/\s+/).length,
                label: {
                  x: label.x,
                  y: label.y,
                  width: label.width,
                  bottom: label.bottom,
                },
                track: { x: track.x, y: track.y, width: track.width },
              }
            }),
          }))

        // then
        expect(
          layout.document,
          `${tier}: whole trace page`,
        ).toBeLessThanOrEqual(layout.viewport + 1)
        expect(layout.rows).toHaveLength(6)
        for (const row of layout.rows) {
          expect(row.columns, tier).toBe(columns)
          if (columns === 1) {
            expect(Math.abs(row.track.x - row.label.x)).toBeLessThanOrEqual(1)
            expect(row.track.y).toBeGreaterThanOrEqual(row.label.bottom - 1)
            expect(
              Math.abs(row.track.width - row.label.width),
            ).toBeLessThanOrEqual(1)
          } else {
            expect(row.track.x).toBeGreaterThan(row.label.x)
            expect(Math.abs(row.track.y - row.label.y)).toBeLessThanOrEqual(1)
            expect(row.label.width).toBe(18 * 16)
          }
        }
      })
    },
    30_000,
  )
}

for (const state of ['error', 'empty', 'loading'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given the trace ${state} state at the xl tier`,
      'when its message renders and the viewport narrows to the base tier',
      'it should fit without horizontal document overflow',
    ].join(', '),
    async () => {
      // given — withTrace waits for this state's message to be visible.
      await withTrace(
        'xl',
        async (page) => {
          // when
          await page.setViewportSize({
            width: viewportWidths.base,
            height: phoneViewport.height,
          })
          const overflow = await page.evaluate(() => ({
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }))

          // then
          expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1)
        },
        'waiting',
        state,
      )
    },
    30_000,
  )
}
