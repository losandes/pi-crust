import { afterAll, expect, test } from 'bun:test'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { THEME_STORAGE_KEY } from '../theme/theme'

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

// One Vite dev server for the whole file, not one per `withPage` call.
// Eleven calls across these tests each used to pay for their own
// listen/close cycle, which left this file (and the Chromium instance
// `SessionCard.layout.test.ts` launches at the same time, in the same
// `bun test` process) competing for ports and process teardown for
// several seconds longer than the assertions themselves take — long
// enough, under load, to blow the 5s default hook timeout on
// `afterAll(() => browser.close())` in either file. A page reload sees
// the same server, so nothing about what each test exercises changes.
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
const BASE = `http://127.0.0.1:${HARNESS_PORT}`

afterAll(async () => {
  await browser?.close()
  await server.close()
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
  // A fresh context per call: `localStorage` persists across pages that
  // share a context, and the "choosing a row" test would otherwise leak its
  // chosen theme into the keyboard-navigation test that assumes `auto`.
  const context: BrowserContext = await activeBrowser.newContext()
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
    await page.goto(`${BASE}/__diag__/index.html`)
    await page.waitForSelector('#picker button')
    await run(page, BASE)
  } finally {
    await context.close()
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

test.skipIf(browser === undefined)(
  'the closed trigger shows exactly one icon matching the theme currently applied, falling back to the generic icon for a theme the icon map has never heard of',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    // One page, with the stored preference changed under it and the page
    // reloaded, rather than two separate `withPage` calls — this suite
    // already pays for a server and a browser context once per test, and a
    // second full lifecycle here would buy nothing a reload does not. (Not
    // `addInitScript`: it would re-run, and re-apply, on every reload this
    // test makes.)
    await withPage(TWELVE_THEMES, browser, async (page) => {
      await page.evaluate(
        ([key, value]) => window.localStorage.setItem(key, value),
        [THEME_STORAGE_KEY, 'dark'] as const,
      )
      await page.reload()
      await page.waitForSelector('#picker button')

      const darkIcons = await page.$$eval('#picker button svg', (svgs) =>
        svgs.map((svg) => svg.getAttribute('class') ?? ''),
      )
      expect(darkIcons).toHaveLength(1)
      expect(darkIcons[0]).toContain('lucide-moon')

      await page.evaluate(
        ([key, value]) => window.localStorage.setItem(key, value),
        [THEME_STORAGE_KEY, 'ocean'] as const,
      )
      await page.reload()
      await page.waitForSelector('#picker button')

      const oceanTriggerIcons = await page.$$eval(
        '#picker button svg',
        (svgs) => svgs.map((svg) => svg.getAttribute('class') ?? ''),
      )
      expect(oceanTriggerIcons).toHaveLength(1)
      expect(oceanTriggerIcons[0]).toContain('lucide-palette')

      await page.click('#picker button')
      const oceanOptionIcon = await page.$eval(
        '[role="option"]:has-text("Ocean") svg',
        (svg) => svg.getAttribute('class') ?? '',
      )
      expect(oceanOptionIcon).toContain('lucide-palette')
    })
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'the trigger and the open list carry the ARIA a listbox needs, and only the option matching the current theme name is marked selected',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    await withPage(
      TWELVE_THEMES,
      browser,
      async (page) => {
        await page.evaluate(
          ([key, value]) => window.localStorage.setItem(key, value),
          [THEME_STORAGE_KEY, 'high-contrast'] as const,
        )
        await page.reload()
        await page.waitForSelector('#picker button')

        const trigger = page.locator('#picker button')
        expect(await trigger.getAttribute('aria-haspopup')).toBe('listbox')
        expect(await trigger.getAttribute('aria-expanded')).toBe('false')

        const accessibleName = await trigger.evaluate(
          (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
        )
        expect(accessibleName).toContain('High contrast')

        await trigger.click()
        expect(await trigger.getAttribute('aria-expanded')).toBe('true')

        const listbox = page.locator('[role="listbox"]')
        expect(await listbox.count()).toBe(1)
        const listAccessibleName = await listbox.evaluate(
          (el) => el.getAttribute('aria-label') ?? '',
        )
        expect(listAccessibleName.length).toBeGreaterThan(0)

        const options = await page.$$eval('[role="option"]', (rows) =>
          rows.map((row) => ({
            text: row.textContent ?? '',
            selected: row.getAttribute('aria-selected'),
          })),
        )
        expect(options).toHaveLength(TWELVE_THEMES.length)

        const selected = options.filter((row) => row.selected === 'true')
        expect(selected).toHaveLength(1)
        expect(selected[0]?.text).toContain('High contrast')

        // 'high-contrast' (the name) and 'High contrast' (the label) only
        // disagree by punctuation and case, which alone would not prove
        // selection is keyed on `name` rather than `label`. No other theme
        // in this fixture starts with "High", so an accidental label-prefix
        // match is ruled out directly.
        const notSelected = options.filter((row) => row.selected !== 'true')
        expect(notSelected).toHaveLength(TWELVE_THEMES.length - 1)
        for (const row of notSelected) {
          expect(row.text.startsWith('High')).toBe(false)
        }
      },
    )
  },
  20_000,
)

test.skipIf(browser === undefined)(
  'removing a theme from the registered list removes its row, and adding one adds a row, with no code change here',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc

    await withPage(BUILTIN_THEMES, browser, async (page) => {
      await page.click('#picker button')
      const labels = await page.$$eval('[role="option"]', (rows) =>
        rows.map((row) => row.textContent ?? ''),
      )
      expect(labels.some((text) => text.includes('Ocean'))).toBe(false)
    })

    await withPage(TWELVE_THEMES, browser, async (page) => {
      await page.click('#picker button')
      const labels = await page.$$eval('[role="option"]', (rows) =>
        rows.map((row) => row.textContent ?? ''),
      )
      expect(labels.some((text) => text.includes('Ocean'))).toBe(true)
    })
  },
  20_000,
)
