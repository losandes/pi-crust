import { afterAll, expect, test } from 'bun:test'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { startHarnessServer } from '@/lib/testing'

/*
 * The context tab's panel used to be a `2fr / 3fr` grid with only one
 * child, so its content sat in the 2fr track at ~40% of the available
 * width while the chat, highlights and events tabs filled the panel. This
 * spins up the real Vite dev pipeline (same CSS modules, same component)
 * and measures actual layout in a real browser, because happy-dom does not
 * run a layout engine and cannot see this at all.
 */

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="root" style="width:1280px"></div>
<script type="module" src="/src/domains/activity-runs/src/_components/__fixtures__/activity-run-detail-harness.tsx"></script>
</body></html>`

/*
 * Playwright's Chromium is a ~99MB download and is not vendored. On a
 * machine without it this says so and skips, rather than failing a
 * verification command AGENTS.md tells people to run on a fresh clone. A
 * skip is a check not run, not a check that passed.
 */
const browser: Browser | undefined = await chromium
  .launch()
  .catch(() => undefined)
if (browser === undefined) {
  console.warn(
    'ActivityRunDetail.layout.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

afterAll(async () => {
  await browser?.close()
})

const panelWidths = async (activeBrowser: Browser) => {
  const { server, base } = await startHarnessServer()

  const page = await activeBrowser.newPage()
  try {
    await page.route('**/__diag__/index.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
    )
    await page.goto(`${base}/__diag__/index.html`)
    await page.getByRole('tab', { name: 'events' }).waitFor()
    await page.getByRole('tab', { name: 'context' }).click()

    const contextWidth = await page.$eval('[class*="context"]', (panel) => {
      const content = panel.firstElementChild
      if (!content) return undefined
      const style = getComputedStyle(panel)
      const paddingLeft = Number.parseFloat(style.paddingLeft)
      const paddingRight = Number.parseFloat(style.paddingRight)
      return {
        contentWidth: content.getBoundingClientRect().width,
        containerContentWidth: panel.clientWidth - paddingLeft - paddingRight,
      }
    })

    await page.getByRole('tab', { name: 'events' }).click()
    const eventsWidth = await page.$eval('[class*="events"]', (panel) => {
      const content = panel.firstElementChild
      if (!content) return undefined
      return { contentWidth: content.getBoundingClientRect().width }
    })

    return { contextWidth, eventsWidth }
  } finally {
    await page.close()
    await server.close()
  }
}

test.skipIf(browser === undefined)(
  [
    'given the activity detail panel at a wide viewport',
    'when the context tab is shown',
    'it should fill the panel like the events tab does',
  ].join(', '),
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
    const { contextWidth, eventsWidth } = await panelWidths(browser)
    expect(contextWidth).toBeDefined()
    expect(eventsWidth).toBeDefined()
    if (contextWidth === undefined || eventsWidth === undefined) return // unreachable; narrows the type for tsc

    // 1.1.1 — the context panel's content fills its container's content box.
    expect(
      Math.abs(contextWidth.contentWidth - contextWidth.containerContentWidth),
    ).toBeLessThanOrEqual(0.5)

    // 1.1.3 — the context tab's content width matches the events tab's.
    expect(
      Math.abs(contextWidth.contentWidth - eventsWidth.contentWidth),
    ).toBeLessThanOrEqual(0.5)
  },
  20_000,
)
