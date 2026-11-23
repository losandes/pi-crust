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
  branch = '',
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
        `${base}/__trace__/index.html?status=${status}&state=${state}&branch=${branch}#/fixture:trace-layout`,
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

for (const status of ['running', 'waiting', 'success', 'fail'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given a ${status} run at the base tier`,
      status === 'success'
        ? 'when the run link is opened directly without visiting the dashboard'
        : 'when opening its run page',
      'it should show the recorded branch after its repository and before the start date',
    ].join(', '),
    async () => {
      // given
      await withTrace(
        'base',
        async (page) => {
          // when
          const origin = page.getByTestId('session-repository')
          expect(await origin.textContent()).toBe('unknown')
          expect(
            await origin.evaluate((element) =>
              element.nextElementSibling?.getAttribute('data-testid'),
            ),
          ).toBe('session-branch')
          const branch = page.getByTestId('session-branch')
          const strip = await branch.evaluate((element) => ({
            text: element.textContent,
            previous:
              element.previousElementSibling?.previousElementSibling?.textContent?.trim(),
            next: element.nextElementSibling?.textContent?.trim(),
          }))

          // then
          expect(await branch.count()).toBe(1)
          expect(strip.text).toBe('feature/trace-layout')
          expect(strip.previous).toBe(status)
          expect(strip.next).toStartWith('started')
        },
        status,
      )
    },
    30_000,
  )
}

for (const tier of ['base', 'sm', 'md', 'lg', 'xl', '2xl'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given a successful run at the ${tier} tier`,
      'when opening its run page directly',
      'it should keep its branch visible after its repository and before the start date',
    ].join(', '),
    async () => {
      // given
      await withTrace(
        tier,
        async (page) => {
          // when
          const branch = page.getByTestId('session-branch')
          const strip = await branch.evaluate((element) => ({
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
            previous:
              element.previousElementSibling?.previousElementSibling?.textContent?.trim(),
            next: element.nextElementSibling?.textContent?.trim(),
          }))

          // then
          expect(await branch.count()).toBe(1)
          expect(strip.width).toBeGreaterThan(0)
          expect(strip.height).toBeGreaterThan(0)
          expect(strip.previous).toBe('success')
          expect(strip.next).toStartWith('started')
        },
        'success',
      )
    },
    30_000,
  )
}

test.skipIf(!browserTestsEnabled)(
  [
    'given a run without a recorded branch at the base tier',
    'when opening its run page directly',
    'it should show exactly one working-tree name after its repository and before the start date',
  ].join(', '),
  async () => {
    // given
    await withTrace(
      'base',
      async (page) => {
        // when
        const branch = page.getByTestId('session-branch')
        const strip = await branch.evaluate((element) => ({
          text: element.textContent,
          title: element.getAttribute('title'),
          width: element.getBoundingClientRect().width,
          previous:
            element.previousElementSibling?.previousElementSibling?.textContent?.trim(),
          next: element.nextElementSibling?.textContent?.trim(),
        }))

        // then
        expect(await branch.count()).toBe(1)
        expect(strip.text).toBe('trace')
        expect(strip.title).toBe('trace')
        expect(strip.width).toBeGreaterThan(0)
        expect(strip.previous).toBe('success')
        expect(strip.next).toStartWith('started')
      },
      'success',
      'populated',
      'none',
    )
  },
  30_000,
)

for (const tier of ['base', 'sm', 'md', 'lg', 'xl', '2xl'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given a run with a 120-character branch at the ${tier} tier`,
      'when opening its run page directly',
      'it should avoid horizontal document overflow and keep status and start date visible',
    ].join(', '),
    async () => {
      // given
      await withTrace(
        tier,
        async (page) => {
          // when
          const branch = page.getByTestId('session-branch')
          const layout = await branch.evaluate((element) => {
            const status = element.previousElementSibling
            const started = element.nextElementSibling
            if (!(status && started)) throw new Error('Missing strip siblings')
            return {
              length: element.textContent?.length,
              title: element.getAttribute('title'),
              document: document.documentElement.scrollWidth,
              viewport: window.innerWidth,
              siblings: [status, started].map((sibling) => {
                const { left, right, width, height } =
                  sibling.getBoundingClientRect()
                return { left, right, width, height }
              }),
            }
          })

          // then
          expect(layout.length).toBe(120)
          expect(layout.title).toBe(`feature/${'x'.repeat(112)}`)
          expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)
          for (const rect of layout.siblings) {
            expect(rect.width).toBeGreaterThan(0)
            expect(rect.height).toBeGreaterThan(0)
            expect(rect.left).toBeGreaterThanOrEqual(0)
            expect(rect.right).toBeLessThanOrEqual(layout.viewport)
          }
        },
        'success',
        'populated',
        'long',
      )
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
