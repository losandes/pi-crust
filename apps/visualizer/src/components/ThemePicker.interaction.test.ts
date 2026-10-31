import { afterAll, expect, test } from 'bun:test'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Fixed and off the dev-server/preview/other-harness ports this app
// otherwise uses (4600/4601 — vite.config.ts; 59_743 — SessionCard.layout.test.ts),
// so this never races a running `dev:all` or the other browser test.
const HARNESS_PORT = 59_744

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="picker"></div>
<script type="module" src="/src/components/__fixtures__/theme-picker-harness.tsx"></script>
</body></html>`

const BUILTIN_THEMES = [
  { name: 'auto', label: 'Match the system', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
]

const TWELVE_THEMES = [
  ...BUILTIN_THEMES,
  { name: 'high-contrast', label: 'High contrast', builtin: false, css: '' },
  { name: 'ocean', label: 'Ocean', builtin: false, css: '' },
  { name: 'forest', label: 'Forest', builtin: false, css: '' },
  { name: 'sunset', label: 'Sunset', builtin: false, css: '' },
  { name: 'midnight', label: 'Midnight', builtin: false, css: '' },
  { name: 'rose', label: 'Rose', builtin: false, css: '' },
  { name: 'slate', label: 'Slate', builtin: false, css: '' },
  { name: 'amber', label: 'Amber', builtin: false, css: '' },
  { name: 'mono', label: 'Mono', builtin: false, css: '' },
]

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
    'ThemePicker.interaction.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

afterAll(async () => {
  await browser?.close()
})

const withPage = async (
  themes: readonly {
    name: string
    label: string
    builtin: boolean
    css: string
  }[],
  activeBrowser: Browser,
  run: (page: Page, base: string) => Promise<void>,
) => {
  const server = await createServer({
    root: new URL('../../', import.meta.url).pathname,
    server: {
      host: '127.0.0.1',
      port: HARNESS_PORT,
      strictPort: true,
      hmr: false,
    },
    logLevel: 'silent',
  })
  await server.listen()
  const base = `http://127.0.0.1:${HARNESS_PORT}`

  // A fresh context per call: `localStorage` persists across pages that
  // share a context, and the "choosing a row" test would otherwise leak its
  // chosen theme into the keyboard-navigation test that assumes `auto`.
  const context = await activeBrowser.newContext()
  const page = await context.newPage()
  try {
    await page.route('**/__diag__/index.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
    )
    await page.route('**/api/themes', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ themes }),
      }),
    )
    await page.goto(`${base}/__diag__/index.html`)
    await page.waitForSelector('#picker button')
    await run(page, base)
  } finally {
    await context.close()
    await server.close()
  }
}

test.skipIf(browser === undefined)(
  "the trigger's footprint does not grow with the number of registered themes",
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    let twelveRect: { width: number; height: number } | undefined
    let threeRect: { width: number; height: number } | undefined

    await withPage(TWELVE_THEMES, browser, async (page) => {
      twelveRect = await page.$eval('#picker button', (el) => {
        const rect = el.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    })

    await withPage(BUILTIN_THEMES, browser, async (page) => {
      threeRect = await page.$eval('#picker button', (el) => {
        const rect = el.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    })

    expect(twelveRect).toEqual(threeRect)
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'clicking the trigger opens one option per registered theme, each with an icon and a label',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    await withPage(TWELVE_THEMES, browser, async (page) => {
      await page.click('#picker button')
      const rows = await page.$$eval('[role="option"]', (options) =>
        options.map((option) => ({
          svgCount: option.querySelectorAll('svg').length,
          text: option.textContent ?? '',
        })),
      )
      expect(rows).toHaveLength(TWELVE_THEMES.length)
      for (let index = 0; index < TWELVE_THEMES.length; index += 1) {
        expect(rows[index].svgCount).toBe(1)
        expect(rows[index].text).toContain(TWELVE_THEMES[index].label)
      }
    })
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'choosing a row applies that theme, closes the list, and returns focus to the trigger',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    await withPage(TWELVE_THEMES, browser, async (page) => {
      await page.click('#picker button')
      await page.click('[role="option"]:has-text("Ocean")')

      const remaining = await page.$$eval(
        '[role="option"]',
        (options) => options.length,
      )
      expect(remaining).toBe(0)
      const choice = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme-choice'),
      )
      expect(choice).toBe('ocean')
      const focused = await page.evaluate(
        () =>
          document.activeElement === document.querySelector('#picker button'),
      )
      expect(focused).toBe(true)
    })
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'ArrowDown and ArrowUp move focus between options, wrapping at both ends',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    await withPage(TWELVE_THEMES, browser, async (page) => {
      await page.click('#picker button')
      const current = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-index'),
      )
      expect(current).toBe('0') // auto is the default stored preference

      await page.keyboard.press('ArrowDown')
      const afterDown = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-index'),
      )
      expect(afterDown).toBe('1')

      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('ArrowUp')
      const wrapped = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-index'),
      )
      expect(wrapped).toBe(String(TWELVE_THEMES.length - 1))
    })
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'Escape closes the list without changing the selection and returns focus to the trigger',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    await withPage(TWELVE_THEMES, browser, async (page) => {
      const before = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme-choice'),
      )
      await page.click('#picker button')
      await page.keyboard.press('Escape')

      const remaining = await page.$$eval(
        '[role="option"]',
        (options) => options.length,
      )
      expect(remaining).toBe(0)
      const after = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme-choice'),
      )
      expect(after).toBe(before)
      const focused = await page.evaluate(
        () =>
          document.activeElement === document.querySelector('#picker button'),
      )
      expect(focused).toBe(true)
    })
  },
  20_000,
)
