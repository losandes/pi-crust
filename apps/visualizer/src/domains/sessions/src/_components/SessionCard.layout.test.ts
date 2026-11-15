import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
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
const CHROMIUM_AVAILABLE = existsSync(chromium.executablePath())
if (!CHROMIUM_AVAILABLE) {
  console.warn(
    'SessionCard.layout.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

const statsClipped = async (variant: 'single' | 'multi') => {
  // Keep browser and server teardown inside each test's existing 20s budget.
  const { server, base } = await startHarnessServer()
  try {
    const activeBrowser = await chromium.launch()
    try {
      const page = await activeBrowser.newPage()
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
      await activeBrowser.close()
    }
  } finally {
    await server.close()
  }
}

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given a single-workspace card',
    'when measuring the stats row',
    'it should keep the stats inside the card',
  ].join(', '),
  async () => {
    // given
    const variant = 'single'

    // when
    const result = await statsClipped(variant)

    // then
    expect(result.hasStats).toBe(true)
    expect(result.clipped).toBe(false)
  },
  20_000,
)

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given a multi-workspace card with a workspace chip',
    'when measuring the stats row',
    'it should keep the stats inside the card',
  ].join(', '),
  async () => {
    // given
    const variant = 'multi'

    // when
    const result = await statsClipped(variant)

    // then
    expect(result.hasStats).toBe(true)
    // Reproduces the report: "content inside the cards gets pushed down beyond
    // the bottom so you can't see the bottom row of information."
    expect(result.clipped).toBe(false)
  },
  20_000,
)
