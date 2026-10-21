import { afterAll, expect, test } from 'bun:test'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// A different fixed port from SessionCard.layout.test.ts's 59_743, so this
// file's own Vite server never races that one when bun runs test files
// concurrently.
const HARNESS_PORT = 59_744

/*
 * SessionCard.layout.test.ts proves the symptom: a multi-workspace card's
 * stats row is pushed past the card's bottom edge. That proves the chip's
 * extra row is unbudgeted somewhere, but not where the budget lives or how
 * much of it the chip is owed. A fix that merely stops the overflow from
 * exceeding the card's bounds — for example by pinning the footer out of
 * flow so it overlaps the timeline instead of spilling past the edge — would
 * pass that test without the card ever growing to hold the extra row.
 *
 * This measures the card's own rendered height in both variants, so a fix
 * must show its work: the single-workspace card must stay exactly as tall as
 * it is today, and the multi-workspace card must grow by exactly the
 * workspace chip's own slot (22px chip + 10px column gap = 32px), not by
 * some other amount and not by moving content around inside an unchanged box.
 */

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="single" style="width:360px"></div>
<div id="multi" style="width:360px"></div>
<script type="module" src="/src/components/__fixtures__/session-card-harness.tsx"></script>
</body></html>`

/*
 * Playwright's Chromium is a ~99MB download and is not vendored. On a machine
 * without it this says so and skips, rather than failing a verification
 * command AGENTS.md tells people to run on a fresh clone. A skip is a check
 * not run, not a check that passed.
 */
const browser: Browser | undefined = await chromium.launch().catch(() => undefined)
if (browser === undefined) {
  console.warn(
    'SessionCard.layout.budget.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

afterAll(async () => {
  await browser?.close()
})

const cardHeight = async (variant: 'single' | 'multi', activeBrowser: Browser) => {
  const server = await createServer({
    root: new URL('../../', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: HARNESS_PORT, strictPort: true, hmr: false },
    logLevel: 'silent',
  })
  await server.listen()
  const base = `http://127.0.0.1:${HARNESS_PORT}`

  const page = await activeBrowser.newPage()
  try {
    await page.route('**/__diag__/index.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
    )
    await page.goto(`${base}/__diag__/index.html`)
    await page.waitForSelector(`#${variant} a`)
    return await page.$eval(`#${variant} a`, (card) => card.getBoundingClientRect().height)
  } finally {
    await page.close()
    await server.close()
  }
}

test.skipIf(browser === undefined)(
  'a single-workspace card keeps its existing height — the chip adds no budget when it is not shown',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
    const height = await cardHeight('single', browser)
    expect(height).toBeCloseTo(420, 0)
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'a multi-workspace card grows by exactly the workspace chip\u2019s own slot (22px chip + 10px gap)',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
    const height = await cardHeight('multi', browser)
    expect(height).toBeCloseTo(452, 0)
  },
  20_000,
)
