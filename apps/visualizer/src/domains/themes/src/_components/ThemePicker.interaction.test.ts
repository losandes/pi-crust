import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { startHarnessServer } from '@/lib/testing'
import { THEME_STORAGE_KEY } from '../state/theme-store'

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="picker"></div>
<script type="module" src="/src/domains/themes/src/_components/__fixtures__/theme-picker-harness.tsx"></script>
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
const CHROMIUM_AVAILABLE = existsSync(chromium.executablePath())
if (!CHROMIUM_AVAILABLE) {
  console.warn(
    'ThemePicker.interaction.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

const withPage = async (
  themes: readonly {
    name: string
    label: string
    builtin: boolean
    css: string
  }[],
  run: (page: Page, base: string) => Promise<void>,
) => {
  // Each call owns its browser and server, keeping teardown inside the
  // caller's existing 20s budget rather than a separate 5s hook budget.
  // Fresh browser storage prevents one theme choice leaking into another test.
  const { server, base } = await startHarnessServer()
  try {
    const activeBrowser = await chromium.launch()
    try {
      const page = await activeBrowser.newPage()
      await page.route('**/__diag__/index.html', (route) =>
        route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
      )
      await page.route('**/api/themes*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ themes }),
        }),
      )
      await page.goto(`${base}/__diag__/index.html`)
      await page.waitForSelector('#picker button')
      await run(page, base)
    } finally {
      await activeBrowser.close()
    }
  } finally {
    await server.close()
  }
}

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given a theme picker with three or twelve registered themes',
    'when measuring the closed trigger',
    'it should keep the same footprint',
  ].join(', '),
  async () => {
    // given
    let twelveRect: { width: number; height: number } | undefined
    let threeRect: { width: number; height: number } | undefined

    // when
    await withPage(TWELVE_THEMES, async (page) => {
      twelveRect = await page.$eval('#picker button', (el) => {
        const rect = el.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    })

    await withPage(BUILTIN_THEMES, async (page) => {
      threeRect = await page.$eval('#picker button', (el) => {
        const rect = el.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    })

    // then
    expect(twelveRect).toEqual(threeRect)
  },
  20_000,
)

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given twelve registered themes',
    'when clicking the picker trigger',
    'it should open one option per registered theme, each with an icon and a label',
  ].join(', '),
  async () => {
    // given
    await withPage(TWELVE_THEMES, async (page) => {
      // when, then
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

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given an open theme picker',
    'when choosing a theme row',
    'it should apply that theme, close the list, and return focus to the trigger',
  ].join(', '),
  async () => {
    // given
    await withPage(TWELVE_THEMES, async (page) => {
      // when, then
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

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given an open theme picker with the default preference',
    'when pressing ArrowDown and ArrowUp',
    'it should move focus between options and wrap at both ends',
  ].join(', '),
  async () => {
    // given
    await withPage(TWELVE_THEMES, async (page) => {
      // when, then
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

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given an open theme picker',
    'when pressing Escape',
    'it should close the list without changing the selection and return focus to the trigger',
  ].join(', '),
  async () => {
    // given
    await withPage(TWELVE_THEMES, async (page) => {
      // when, then
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

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given a stored theme preference',
    'when applying a known theme and then one with no mapped icon',
    'it should show exactly one matching icon and fall back to the generic icon',
  ].join(', '),
  async () => {
    // given
    // Reload within one owned browser so localStorage survives navigation;
    // a second withPage call intentionally starts with clean storage.
    // addInitScript would reapply the preference on every reload instead.
    await withPage(TWELVE_THEMES, async (page) => {
      // when, then
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

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given a theme picker with a stored named preference',
    'when opening the list',
    'it should expose listbox ARIA and mark only the option matching the theme name as selected',
  ].join(', '),
  async () => {
    // given
    await withPage(TWELVE_THEMES, async (page) => {
      // when, then
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
    })
  },
  20_000,
)

test.skipIf(!CHROMIUM_AVAILABLE)(
  [
    'given two different registered theme lists',
    'when opening each picker',
    'it should remove and add rows according to the registered list without a code change',
  ].join(', '),
  async () => {
    // given
    await withPage(BUILTIN_THEMES, async (page) => {
      // when, then
      await page.click('#picker button')
      const labels = await page.$$eval('[role="option"]', (rows) =>
        rows.map((row) => row.textContent ?? ''),
      )
      expect(labels.some((text) => text.includes('Ocean'))).toBe(false)
    })

    await withPage(TWELVE_THEMES, async (page) => {
      await page.click('#picker button')
      const labels = await page.$$eval('[role="option"]', (rows) =>
        rows.map((row) => row.textContent ?? ''),
      )
      expect(labels.some((text) => text.includes('Ocean'))).toBe(true)
    })
  },
  20_000,
)
