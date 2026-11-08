import { afterAll, expect, test } from 'bun:test'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { startHarnessServer } from '@/lib/testing'

/*
 * `.card` is a fixed 420px flex column (SessionCard.module.css) with
 * `overflow: hidden`. Everything above `.timeline` is a normal flex child
 * with no reserved slot — including the `.workspace` chip, which only
 * renders "when more than one is watched" (SessionCard.tsx). Adding that
 * chip adds a row's height plus a `.card` gap to the column without adding
 * anything to the 420px budget, so once several workspaces are being
 * watched the `.stats` row (cost / runtime / tokens — the bottom row of
 * information) is pushed past the card's bottom edge and clipped.
 *
 * This spins up the real Vite dev pipeline (same CSS modules, same
 * component) and measures actual layout in a real browser, because
 * happy-dom does not run a layout engine and cannot see this at all.
 */

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="single" style="width:360px"></div>
<div id="multi" style="width:360px"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/session-card-harness.tsx"></script>
</body></html>`

/*
 * Playwright's Chromium is a ~99MB download and is not vendored. On a machine
 * without it this says so and skips, rather than failing a verification
 * command AGENTS.md tells people to run on a fresh clone. A skip is a check
 * not run, not a check that passed.
 */
const browser: Browser | undefined = await chromium
  .launch()
  .catch(() => undefined)
if (browser === undefined) {
  console.warn(
    'SessionCard.layout.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

afterAll(async () => {
  await browser?.close()
})

const statsClipped = async (
  variant: 'single' | 'multi',
  activeBrowser: Browser,
) => {
  const { server, base } = await startHarnessServer()

  const page = await activeBrowser.newPage()
  try {
    await page.route('**/__diag__/index.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
    )
    await page.goto(`${base}/__diag__/index.html`)
    await page.waitForSelector(`#${variant} a`)
    return await page.$eval(`#${variant} a`, (card) => {
      const stats = card.querySelector('[class*="stats"]')
      if (!stats) return { hasStats: false, clipped: false }
      const cardBottom = card.getBoundingClientRect().bottom
      const statsBottom = stats.getBoundingClientRect().bottom
      return { hasStats: true, clipped: statsBottom > cardBottom + 0.5 }
    })
  } finally {
    await page.close()
    await server.close()
  }
}

test.skipIf(browser === undefined)(
  'stats row stays inside the card when only one workspace is watched',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
    const result = await statsClipped('single', browser)
    expect(result.hasStats).toBe(true)
    expect(result.clipped).toBe(false)
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'workspace chip pushes the stats row past the bottom of a multi-workspace card',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
    const result = await statsClipped('multi', browser)
    expect(result.hasStats).toBe(true)
    // Reproduces the report: "content inside the cards gets pushed down beyond
    // the bottom so you can't see the bottom row of information."
    expect(result.clipped).toBe(false)
  },
  20_000,
)
