import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { chromium, devices, type Page } from 'playwright'
import { startHarnessServer, viewportWidths } from '@/lib/testing'

const hasChromium = existsSync(chromium.executablePath())
if (!hasChromium) {
  console.warn(
    'style.test.ts: no Chromium — skipping browser checks. Run `bunx playwright install chromium`.',
  )
}

const registeredTheme = {
  name: 'high-contrast',
  label: 'High contrast',
  builtin: false,
  css: readFileSync(
    new URL(
      '../../../templates/stamp/config/high-contrast.css',
      import.meta.url,
    ),
    'utf8',
  ),
}

const NATIVE_HTML = `<section id="native-prose">
<h1>Heading</h1><p>Paragraph</p>
<ul><li>Bullet</li></ul><ol><li>Number</li></ol>
<code>Code</code><button>Control</button>
<input placeholder="Placeholder"><dialog>Dialog</dialog>
</section>`

const HARNESS_HTML = `<!doctype html>
<html><body>
<select id="theme-choice">
  <option>dark</option><option>light</option><option>auto</option>
  <option>high-contrast</option>
</select>
${NATIVE_HTML}
<button id="utility-control" class="font-sans">Utility control</button>
<div id="utility" class="text-ok bg-fail/16 border-violet/45 font-sans">Theme</div>
<div id="reference" style="color:var(--ok);background-color:color-mix(in oklab,var(--fail) 16%,transparent);border-color:color-mix(in oklab,var(--violet) 45%,transparent);font-family:var(--sans)">Theme</div>
<div style="--ok:var(--fail)">
  <span id="scoped" class="text-ok">Scoped</span>
  <span id="scoped-reference" style="color:var(--fail)">Scoped</span>
</div>
<span id="card-font" class="font-card">Reading</span>
<span id="card-reference" style="font-family:var(--card-sans)">Reading</span>
<span id="mono-font" class="font-mono">Code</span>
<span id="mono-reference" style="font-family:var(--mono)">Code</span>
<div class="md">
  <h1>Heading</h1>
  <ul><li>Bullet</li></ul>
  <ol><li>Number</li></ol>
</div>
<menu id="preflight-list"><li>Unstyled</li></menu>
<span id="spinner"><span id="spinner-icon" data-animation></span></span>
<span id="activity" data-animation>Running</span>
<span id="card-dot" data-animation></span>
<span id="trace-status" data-animation>Running</span>
<button id="trace-block" data-animation>Activity</button>
<span id="live-dot" data-animation></span>
<div id="sm" class="hidden sm:block">sm</div>
<div id="md" class="hidden md:block">md</div>
<div id="lg" class="hidden lg:block">lg</div>
<div id="xl" class="hidden xl:block">xl</div>
<div id="2xl" class="hidden 2xl:block">2xl</div>
<script type="module">
import '/src/style.css'
import { applyCustomThemes, applyTheme } from '/src/domains/themes/index.ts'
import chip from '/src/lib/_components/src/atoms/StatusChip.module.css'
import dots from '/src/domains/activity-runs/src/_components/ActivityRunDots.module.css'
import card from '/src/domains/sessions/src/_components/SessionCard.module.css'
import trace from '/src/domains/sessions/src/_components/SessionTrace.module.css'
import layout from '/src/layouts/default-layout.module.css'
applyCustomThemes(document, [${JSON.stringify(registeredTheme)}])
applyTheme(document.documentElement, 'dark', window.matchMedia)
document.getElementById('theme-choice').addEventListener('change', (event) => {
  applyTheme(document.documentElement, event.target.value, window.matchMedia)
})
const classes = {
  spinner: [chip.chip, chip.running],
  'spinner-icon': [chip.icon],
  activity: [dots.running],
  'card-dot': [card.dot, card.latest],
  'trace-status': [trace.blockStatus, trace.running],
  'trace-block': [trace.block, trace.running],
  'live-dot': [layout.liveDot],
}
for (const [id, names] of Object.entries(classes)) {
  document.getElementById(id).className = names.join(' ')
}
document.documentElement.setAttribute('data-ready', 'true')
</script>
</body></html>`

const withStyles = async (check: (page: Page) => Promise<void>) => {
  const { server, base } = await startHarnessServer()
  try {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({
        viewport: {
          width: viewportWidths.xl,
          height: devices['iPhone SE'].viewport.height,
        },
      })
      const page = await context.newPage()
      await page.route('**/__styles__/index.html', (route) =>
        route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
      )
      await page.goto(`${base}/__styles__/index.html`)
      await page.waitForSelector('[data-ready="true"]')
      await check(page)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

test.skipIf(!hasChromium)(
  [
    'given the Tailwind theme bridge',
    'when dark, light, auto and a registered theme swap at runtime',
    'it should repaint utilities and opacity modifiers from the live tokens',
  ].join(', '),
  async () => {
    // given
    await withStyles(async (page) => {
      const readColors = () =>
        page.locator('#utility, #reference').evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            return {
              color: style.color,
              background: style.backgroundColor,
              border: style.borderColor,
              font: style.fontFamily,
            }
          }),
        )
      const [dark, darkReference] = await readColors()
      expect(dark).toEqual(darkReference)

      // when
      await page.selectOption('#theme-choice', 'light')
      const [light, lightReference] = await readColors()
      await page.emulateMedia({ colorScheme: 'light' })
      await page.selectOption('#theme-choice', 'auto')
      const [auto] = await readColors()
      await page.selectOption('#theme-choice', 'high-contrast')
      const [registered, registeredReference] = await readColors()

      // then
      expect(light).toEqual(lightReference)
      expect(light).not.toEqual(dark)
      expect(auto).toEqual(light)
      expect(registered).toEqual(registeredReference)
      expect(registered).not.toEqual(dark)
      for (const selectors of [
        '#scoped, #scoped-reference',
        '#card-font, #card-reference',
        '#mono-font, #mono-reference',
      ]) {
        const [actual, reference] = await page
          .locator(selectors)
          .evaluateAll((elements) =>
            elements.map((element) => {
              const style = getComputedStyle(element)
              return { color: style.color, font: style.fontFamily }
            }),
          )
        expect(actual).toEqual(reference)
      }
    })
  },
  20_000,
)

test.skipIf(!hasChromium)(
  [
    'given preflight and the existing animation styles at the xl tier',
    'when markdown and running indicators render',
    'it should preserve prose markers and the application-owned animations',
  ].join(', '),
  async () => {
    // given
    await withStyles(async (page) => {
      // when
      const markers = await page
        .locator('.md ul, .md ol, #preflight-list')
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).listStyleType),
        )
      const headingWeight = await page
        .locator('.md h1')
        .evaluate((element) => getComputedStyle(element).fontWeight)
      const animations = await page
        .locator('[data-animation]')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            return {
              name: style.animationName,
              duration: style.animationDuration,
              running: element
                .getAnimations()
                .some((animation) => animation.playState === 'running'),
            }
          }),
        )

      // then
      expect(markers).toEqual(['disc', 'decimal', 'none'])
      expect(headingWeight).toBe('700')
      expect(animations).toEqual([
        { name: 'crust-spin', duration: '1.1s', running: true },
        { name: 'crust-pulse', duration: '1.2s', running: true },
        { name: 'crust-pulse', duration: '1.4s', running: true },
        { name: 'crust-pulse', duration: '1.2s', running: true },
        { name: 'crust-pulse', duration: '1.6s', running: true },
        { name: 'crust-pulse', duration: '1.6s', running: true },
      ])
    })
  },
  20_000,
)

test.skipIf(!hasChromium)(
  [
    'given stylesheet-backed controls and raw prose',
    'when preflight is loaded',
    'it should retain native typography and prose spacing below utilities',
  ].join(', '),
  async () => {
    // given
    await withStyles(async (page) => {
      const native = await page.context().newPage()
      try {
        const body = await page.locator('body').evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            font: style.font,
            lineHeight:
              Number.parseFloat(style.lineHeight) /
              Number.parseFloat(style.fontSize),
          }
        })
        await native.setContent(
          `<style>body { font: ${body.font}; line-height: ${body.lineHeight}; color-scheme: dark; }</style>${NATIVE_HTML}`,
        )
        const readDefaults = (target: Page) =>
          target.locator('#native-prose *').evaluateAll((elements) =>
            elements.map((element) => {
              const style = getComputedStyle(element)
              const properties = [
                'font-family',
                'font-size',
                'font-weight',
                'line-height',
                'letter-spacing',
                'margin-top',
                'margin-right',
                'margin-bottom',
                'margin-left',
                'list-style-type',
                'appearance',
              ]
              return {
                ...Object.fromEntries(
                  properties.map((property) => [
                    property,
                    style.getPropertyValue(property),
                  ]),
                ),
                listPadding: element.matches('ul, ol')
                  ? style.paddingInlineStart
                  : '',
                placeholder: element.matches('input')
                  ? getComputedStyle(element, '::placeholder').color
                  : '',
              }
            }),
          )

        // when
        const expected = await readDefaults(native)
        const actual = await readDefaults(page)
        const utilityFont = await page
          .locator('#utility-control')
          .evaluate((element) => getComputedStyle(element).fontFamily)
        const bodyFont = await page
          .locator('body')
          .evaluate((element) => getComputedStyle(element).fontFamily)

        // then
        expect(actual).toEqual(expected)
        expect(utilityFont).toBe(bodyFont)
      } finally {
        await native.close()
      }
    })
  },
  20_000,
)

test.skipIf(!hasChromium)(
  [
    'given theme-derived viewport widths',
    'when the browser crosses each named tier',
    'it should match the minimum widths of the generated breakpoint variants',
  ].join(', '),
  async () => {
    // given
    await withStyles(async (page) => {
      const height = devices['iPhone SE'].viewport.height

      // when, then
      await page.setViewportSize({ width: viewportWidths.base, height })
      expect(await page.locator('#sm').isVisible()).toBe(false)
      for (const [tier, width] of Object.entries(viewportWidths)) {
        if (tier === 'base') continue
        await page.setViewportSize({ width: width - 1, height })
        expect(await page.locator(`[id="${tier}"]`).isVisible()).toBe(false)
        await page.setViewportSize({ width, height })
        expect(await page.locator(`[id="${tier}"]`).isVisible()).toBe(true)
      }
    })
  },
  20_000,
)
