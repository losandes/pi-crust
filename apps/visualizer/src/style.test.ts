import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { chromium, devices, type Page } from 'playwright'
import { build } from 'vite'
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

// Issue #85, section 2.1: every bridged colour, not the palette's extra rungs.
const COLOR_UTILITIES = {
  bg: 'text-bg bg-bg border-bg',
  'app-bg': 'text-app-bg bg-app-bg border-app-bg',
  surface: 'text-surface bg-surface border-surface',
  panel: 'text-panel bg-panel border-panel',
  'panel-2': 'text-panel-2 bg-panel-2 border-panel-2',
  'panel-3': 'text-panel-3 bg-panel-3 border-panel-3',
  zebra: 'text-zebra bg-zebra border-zebra',
  'table-head': 'text-table-head bg-table-head border-table-head',
  border: 'text-border bg-border border-border',
  'border-soft': 'text-border-soft bg-border-soft border-border-soft',
  text: 'text-text bg-text border-text',
  dim: 'text-dim bg-dim border-dim',
  faint: 'text-faint bg-faint border-faint',
  ok: 'text-ok bg-ok border-ok',
  fail: 'text-fail bg-fail border-fail',
  busy: 'text-busy bg-busy border-busy',
  warn: 'text-warn bg-warn border-warn',
  waiting: 'text-waiting bg-waiting border-waiting',
  accent: 'text-accent bg-accent border-accent',
  green: 'text-green bg-green border-green',
  red: 'text-red bg-red border-red',
  blue: 'text-blue bg-blue border-blue',
  amber: 'text-amber bg-amber border-amber',
  purple: 'text-purple bg-purple border-purple',
  cyan: 'text-cyan bg-cyan border-cyan',
  violet: 'text-violet bg-violet border-violet',
  pink: 'text-pink bg-pink border-pink',
} as const

const COLOR_PROBES = Object.entries(COLOR_UTILITIES)
  .map(
    ([role, classes]) => `<div data-color-role="${role}">
  <span data-color-utility class="${classes}">${role}</span>
  <span data-color-reference style="color:var(--${role});background-color:var(--${role});border-color:var(--${role})">${role}</span>
</div>`,
  )
  .join('')

const THEME_PROBES = `<div id="soft-fill" class="bg-ok/10">Soft fill</div>
<div id="soft-fill-reference" style="background-color:color-mix(in oklab,var(--ok) 10%,transparent)">Soft fill</div>
<div id="utility" class="text-ok bg-fail/16 border-violet/45 font-sans">Theme</div>
<div id="reference" style="color:var(--ok);background-color:color-mix(in oklab,var(--fail) 16%,transparent);border-color:color-mix(in oklab,var(--violet) 45%,transparent);font-family:var(--sans)">Theme</div>
<div style="--ok:var(--fail)">
  <span id="scoped" class="text-ok">Scoped</span>
  <span id="scoped-reference" style="color:var(--fail)">Scoped</span>
</div>
<span id="card-font" class="font-card">Reading</span>
<span id="card-reference" style="font-family:var(--card-sans)">Reading</span>
<span id="mono-font" class="font-mono">Code</span>
<span id="mono-reference" style="font-family:var(--mono)">Code</span>`

const NATIVE_HTML = `<section id="native-prose">
<h1>Heading</h1><p>Paragraph</p>
<ul><li>Bullet</li></ul><ol><li>Number</li></ol>
<code>Code</code><button>Control</button>
<input placeholder="Placeholder"><dialog>Dialog</dialog>
<input type="checkbox"><input type="radio">
</section>`

const HARNESS_HTML = `<!doctype html>
<html><body>
<select id="theme-choice">
  <option>dark</option><option>light</option><option>auto</option>
  <option>high-contrast</option>
</select>
${NATIVE_HTML}
<div>
  <section id="detail-section-margin">
    <button id="detail-section-head" type="button">Margins</button>
    <div id="detail-section-body"><p id="detail-section-paragraph">Body paragraph</p></div>
  </section>
  <div id="after-detail-section">After the section</div>
</div>
${COLOR_PROBES}
<section id="radius-probes">
  <span id="legacy-radius" data-radius style="border-radius:var(--radius-sm, 3px)">Legacy fallback</span>
  <pre id="narration-radius-code" data-radius>Code</pre>
  <div id="decision-radius-body">
    <code id="decision-radius-code" data-radius>Code</code>
    <pre id="decision-radius-pre" data-radius>Code block</pre>
  </div>
  <span id="legacy-radius-four" data-radius style="border-radius:var(--radius-sm, 4px)">Other fallback</span>
  <span id="utility-radius-small" data-radius class="rounded-sm">Small utility</span>
  <span id="utility-radius-top" data-radius class="rounded-t-sm">Top utility</span>
  <span id="utility-radius-medium" data-radius class="rounded-md">Medium utility</span>
</section>
<button id="utility-control" class="font-sans">Utility control</button>
${THEME_PROBES}
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
<span id="live-dot" class="animate-[crust-pulse_1.6s_ease-in-out_infinite]" data-animation></span>
<div id="sm" class="hidden sm:block">sm</div>
<div id="md" class="hidden md:block">md</div>
<div id="lg" class="hidden lg:block">lg</div>
<div id="xl" class="hidden xl:block">xl</div>
<div id="2xl" class="hidden 2xl:block">2xl</div>
<script type="module">
import '/src/style.css'
import { applyCustomThemes, applyTheme } from '/src/domains/themes/index.ts'
import { DetailSection, StatusChip } from '/src/lib/_components/index.ts'
import dots from '/src/domains/activity-runs/src/_components/ActivityRunDots.module.css'
import card from '/src/domains/sessions/src/_components/SessionCard.module.css'
import trace from '/src/domains/sessions/src/_components/SessionTrace.module.css'
import narration from '/src/domains/narration/src/_components/NarrationPane.module.css'
import decision from '/src/domains/decisions/src/_components/DecisionRequest.module.css'
applyCustomThemes(document, [${JSON.stringify(registeredTheme)}])
applyTheme(document.documentElement, 'dark', window.matchMedia)
document.getElementById('theme-choice').addEventListener('change', (event) => {
  applyTheme(document.documentElement, event.target.value, window.matchMedia)
})
const runningChip = StatusChip({ status: 'running' })
const detailSection = DetailSection({ title: 'Margins', open: true, onToggle: () => {} })
const classes = {
  'detail-section-margin': [detailSection.props.className],
  'detail-section-head': [detailSection.props.children[0].props.className],
  'detail-section-body': [detailSection.props.children[1].props.className],
  spinner: [runningChip.props.className],
  'spinner-icon': [runningChip.props.children[0].props.className],
  activity: [dots.running],
  'card-dot': [card.dot, card.latest],
  'trace-status': [trace.blockStatus, trace.running],
  'trace-block': [trace.block, trace.running],
  'narration-radius-code': [narration.code],
  'decision-radius-body': [decision.body],
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

const readColorProbes = (page: Page) =>
  page.locator('[data-color-role]').evaluateAll((elements) => {
    const pairs = elements.map((element) => {
      const role = element.getAttribute('data-color-role')
      const utility = element.querySelector('[data-color-utility]')
      const reference = element.querySelector('[data-color-reference]')
      if (!(role && utility && reference)) {
        throw new Error('Incomplete semantic colour probe')
      }
      const read = (target: Element) => {
        const style = getComputedStyle(target)
        return {
          color: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
        }
      }
      return { role, actual: read(utility), expected: read(reference) }
    })
    return {
      actual: Object.fromEntries(
        pairs.map(({ role, actual }) => [role, actual]),
      ),
      expected: Object.fromEntries(
        pairs.map(({ role, expected }) => [role, expected]),
      ),
    }
  })

for (const theme of ['dark', 'light', 'auto', 'high-contrast']) {
  test.skipIf(!hasChromium)(
    [
      `given issue #85 colour roles under the ${theme} theme`,
      'when utilities render and their semantic variables change in a subtree',
      'it should resolve every colour at its use site and support the soft-fill opacity modifier',
    ].join(', '),
    async () => {
      // given — requirements 1.3.1–1.3.3 and target state 2.1
      await withStyles(async (page) => {
        await page.emulateMedia({ colorScheme: 'light' })
        await page.selectOption('#theme-choice', theme)
        const inherited = await readColorProbes(page)
        const softFill = await page
          .locator('#soft-fill, #soft-fill-reference')
          .evaluateAll((elements) =>
            elements.map(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          )

        // when
        await page.locator('[data-color-role]').evaluateAll((elements) => {
          for (const element of elements) {
            const role = element.getAttribute('data-color-role')
            const reference = element.querySelector('[data-color-reference]')
            if (!(role && reference)) {
              throw new Error('Incomplete semantic colour probe')
            }
            const original = reference.getAttribute('style') ?? ''
            const color = getComputedStyle(reference).color
            reference.setAttribute('style', 'color:var(--ok)')
            const ok = getComputedStyle(reference).color
            reference.setAttribute('style', original)
            // A different existing role makes a missing utility observable,
            // even when its unscoped colour would equal inherited text.
            const replacement = color === ok ? 'fail' : 'ok'
            element.setAttribute('style', `--${role}:var(--${replacement})`)
          }
        })
        const scoped = await readColorProbes(page)
        const unchanged = Object.keys(inherited.actual).filter(
          (role) =>
            scoped.actual[role]?.color === inherited.actual[role]?.color,
        )

        // then
        expect(Object.keys(inherited.actual)).toEqual(
          Object.keys(COLOR_UTILITIES),
        )
        expect(inherited.actual).toEqual(inherited.expected)
        expect(scoped.actual).toEqual(scoped.expected)
        expect(unchanged).toEqual([])
        expect(softFill).toHaveLength(2)
        expect(softFill[0]).toBe(softFill[1])
      })
    },
    20_000,
  )

  test.skipIf(!hasChromium)(
    [
      `given legacy radius fallbacks under the ${theme} theme`,
      'when CSS Modules render beside Tailwind radius utilities at the xl tier',
      'it should preserve per-declaration fallbacks and the default utility scale',
    ].join(', '),
    async () => {
      // given — requirement 1.7.2 includes both existing small-radius fallbacks
      await withStyles(async (page) => {
        const legacySmall = ['3px', '3px', '3px', '3px']
        const utilitySmall = ['4px', '4px', '4px', '4px']
        await page.emulateMedia({ colorScheme: 'light' })
        await page.selectOption('#theme-choice', theme)

        // when
        const radii = await page
          .locator('[data-radius]')
          .evaluateAll((elements) =>
            Object.fromEntries(
              elements.map((element) => {
                const style = getComputedStyle(element)
                return [
                  element.id,
                  [
                    style.borderTopLeftRadius,
                    style.borderTopRightRadius,
                    style.borderBottomRightRadius,
                    style.borderBottomLeftRadius,
                  ],
                ]
              }),
            ),
          )

        // then
        expect(radii).toEqual({
          'legacy-radius': legacySmall,
          'narration-radius-code': ['0px', '3px', '3px', '0px'],
          'decision-radius-code': legacySmall,
          'decision-radius-pre': legacySmall,
          'legacy-radius-four': utilitySmall,
          'utility-radius-small': utilitySmall,
          'utility-radius-top': ['4px', '4px', '0px', '0px'],
          'utility-radius-medium': ['6px', '6px', '6px', '6px'],
        })
      })
    },
    20_000,
  )
}

test.skipIf(!hasChromium)(
  [
    'given DetailSection with a paragraph at the end of its body',
    'when another block follows the section',
    'it should preserve collapsed margins rather than adding a containment gap',
  ].join(', '),
  async () => {
    // given
    await withStyles(async (page) => {
      // when
      const spacing = await page.evaluate(() => {
        const section = document.getElementById('detail-section-margin')
        const paragraph = document.getElementById('detail-section-paragraph')
        const after = document.getElementById('after-detail-section')
        if (!(section && paragraph && after)) {
          throw new Error('Missing DetailSection margin probe')
        }
        return {
          actual:
            after.getBoundingClientRect().top -
            paragraph.getBoundingClientRect().bottom,
          expected: Math.max(
            Number.parseFloat(getComputedStyle(section).marginBottom),
            Number.parseFloat(getComputedStyle(paragraph).marginBottom),
          ),
        }
      })

      // then
      expect(spacing.actual).toBeCloseTo(spacing.expected, 1)
    })
  },
  20_000,
)

const fontCases = [
  {
    name: 'sans',
    variable: '--sans',
    replacement: '--mono',
    selectors: '#utility, #reference',
  },
  {
    name: 'card',
    variable: '--card-sans',
    replacement: '--mono',
    selectors: '#card-font, #card-reference',
  },
  {
    name: 'mono',
    variable: '--mono',
    replacement: '--sans',
    selectors: '#mono-font, #mono-reference',
  },
] as const

for (const { name, variable, replacement, selectors } of fontCases) {
  test.skipIf(!hasChromium)(
    [
      `given the issue #85 font-${name} utility`,
      'when its semantic font variable is overridden locally',
      'it should use the local font rather than the root alias',
    ].join(', '),
    async () => {
      // given — requirements 1.3.1 and target state 2.1
      await withStyles(async (page) => {
        const readFonts = () =>
          page
            .locator(selectors)
            .evaluateAll((elements) =>
              elements.map((element) => getComputedStyle(element).fontFamily),
            )
        const inherited = await readFonts()

        // when
        await page.locator(selectors).evaluateAll(
          (elements, { variable, replacement }) => {
            for (const element of elements) {
              const original = element.getAttribute('style') ?? ''
              element.setAttribute(
                'style',
                `${original};${variable}:var(${replacement})`,
              )
            }
          },
          { variable, replacement },
        )
        const scoped = await readFonts()

        // then
        expect(scoped).toHaveLength(2)
        expect(scoped[0]).toBe(scoped[1])
        expect(scoped[0]).not.toBe(inherited[0])
      })
    },
    20_000,
  )
}

test.skipIf(!hasChromium)(
  [
    'given the issue #85 application-owned pulse at stylesheet and utility call sites',
    'when each animation is sampled at the start, midpoint and next cycle',
    'it should retain the original full-opacity endpoints and pulse depth',
  ].join(', '),
  async () => {
    // given — requirements 1.2.1, 1.7.2 and target state 2.1
    await withStyles(async (page) => {
      // when
      const opacities = await page
        .locator('[data-animation]:not(#spinner-icon)')
        .evaluateAll((elements) =>
          Object.fromEntries(
            elements.map((element) => {
              const [animation] = element.getAnimations()
              const duration = animation?.effect?.getComputedTiming().duration
              if (!animation || typeof duration !== 'number') {
                throw new Error(`Missing pulse animation on ${element.id}`)
              }
              animation.pause()
              const frames = [0, 0.5, 1].map((progress) => {
                // biome-ignore lint/plugin/no-object-mutation: seeking a browser-owned Animation requires the currentTime setter.
                animation.currentTime = duration * progress
                return Number(getComputedStyle(element).opacity)
              })
              return [element.id, frames]
            }),
          ),
        )

      // then
      expect(opacities).toEqual({
        activity: [1, 0.35, 1],
        'card-dot': [1, 0.35, 1],
        'trace-status': [1, 0.35, 1],
        'trace-block': [1, 0.35, 1],
        'live-dot': [1, 0.35, 1],
      })
    })
  },
  20_000,
)

test.skipIf(!hasChromium)(
  [
    'given the issue #85 application-owned running spinner',
    'when its animation advances by quarter turns',
    'it should retain a complete clockwise revolution',
  ].join(', '),
  async () => {
    // given — requirements 1.2.2, 1.7.2 and target state 2.1
    await withStyles(async (page) => {
      // when
      const rotations = await page
        .locator('#spinner-icon')
        .evaluate((element) => {
          const [animation] = element.getAnimations()
          const duration = animation?.effect?.getComputedTiming().duration
          if (!animation || typeof duration !== 'number') {
            throw new Error('Missing running-status spinner animation')
          }
          animation.pause()
          return [0, 0.25, 0.5, 0.75, 1].map((progress) => {
            // biome-ignore lint/plugin/no-object-mutation: seeking a browser-owned Animation requires the currentTime setter.
            animation.currentTime = duration * progress
            const matrix = new DOMMatrix(getComputedStyle(element).transform)
            return [matrix.a, matrix.b, matrix.c, matrix.d]
          })
        })

      // then
      const zero = expect.closeTo(0, 5)
      expect(rotations).toEqual([
        [1, zero, zero, 1],
        [zero, 1, -1, zero],
        [-1, zero, zero, -1],
        [zero, -1, 1, zero],
        [1, zero, zero, 1],
      ])
    })
  },
  20_000,
)

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
                placeholder: element.matches('input[placeholder]')
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

test.skipIf(!hasChromium)(
  [
    'given issue #85 production CSS at the xl tier',
    'when themes change after the build and descendants override semantic variables',
    'it should keep colour utilities, fonts and opacity modifiers live',
  ].join(', '),
  async () => {
    // given — requirements 1.1.2–1.1.4, 1.3.1–1.3.3 and target state 2.1
    const result = await build({
      root: new URL('../', import.meta.url).pathname,
      logLevel: 'silent',
      build: { write: false },
    })
    const outputs = Array.isArray(result) ? result : [result]
    const css = outputs
      .flatMap((output) => ('output' in output ? output.output : []))
      .flatMap((asset) =>
        asset.type === 'asset' && asset.fileName.endsWith('.css')
          ? [
              typeof asset.source === 'string'
                ? asset.source
                : new TextDecoder().decode(asset.source),
            ]
          : [],
      )
      .join('\n')
    expect(css).not.toBe('')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: {
          width: viewportWidths.xl,
          height: devices['iPhone SE'].viewport.height,
        },
      })
      // No development server or stylesheet can mask a production-build gap.
      await page.setContent(`<!doctype html>
<html data-theme="dark"><body>${COLOR_PROBES}${THEME_PROBES}</body></html>`)
      await page.addStyleTag({ content: css })
      await page.addStyleTag({ content: registeredTheme.css })
      const dark = await readColorProbes(page)

      // when
      await page.locator('html').evaluate((element) => {
        element.setAttribute('data-theme', 'light')
      })
      const light = await readColorProbes(page)
      await page.locator('html').evaluate((element) => {
        element.setAttribute('data-theme', 'high-contrast')
      })
      const registered = await readColorProbes(page)
      await page.evaluate((cases) => {
        for (const { selectors, variable, replacement } of cases) {
          for (const element of document.querySelectorAll(selectors)) {
            const original = element.getAttribute('style') ?? ''
            element.setAttribute(
              'style',
              `${original};${variable}:var(${replacement})`,
            )
          }
        }
      }, fontCases)
      const utility = await page
        .locator('#utility, #reference')
        .evaluateAll((elements) =>
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
      const scoped = await page
        .locator('#scoped, #scoped-reference')
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).color),
        )
      const fonts = await page
        .locator('#card-font, #card-reference, #mono-font, #mono-reference')
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).fontFamily),
        )
      const softFill = await page
        .locator('#soft-fill, #soft-fill-reference')
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).backgroundColor),
        )

      // then
      expect(dark.actual).toEqual(dark.expected)
      expect(light.actual).toEqual(light.expected)
      expect(light.actual).not.toEqual(dark.actual)
      expect(registered.actual).toEqual(registered.expected)
      expect(registered.actual).not.toEqual(light.actual)
      expect(utility).toHaveLength(2)
      expect(utility[0]).toEqual(utility[1])
      expect(scoped).toHaveLength(2)
      expect(scoped[0]).toBe(scoped[1])
      expect(fonts).toHaveLength(4)
      expect(fonts[0]).toBe(fonts[1])
      expect(fonts[2]).toBe(fonts[3])
      expect(softFill).toHaveLength(2)
      expect(softFill[0]).toBe(softFill[1])
    } finally {
      await browser.close()
    }
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #85 running indicators and the existing reduced-motion preference',
    'when the preference changes while global animations are loaded',
    'it should shorten every animation to one iteration and restore motion on request',
  ].join(', '),
  async () => {
    // given — requirements 1.2.1–1.2.2, 1.3.4 and 1.7.2
    await withStyles(async (page) => {
      const readMotion = () =>
        page.locator('[data-animation]').evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            return {
              id: element.id,
              name: style.animationName,
              duration: Number.parseFloat(style.animationDuration) * 1000,
              iterations: style.animationIterationCount,
            }
          }),
        )
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const normal = await readMotion()

      // when
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const reduced = await readMotion()
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const restored = await readMotion()

      // then
      expect(normal.map(({ name }) => name)).toEqual([
        'crust-spin',
        'crust-pulse',
        'crust-pulse',
        'crust-pulse',
        'crust-pulse',
        'crust-pulse',
      ])
      expect(
        normal.every(
          ({ duration, iterations }) =>
            duration > 0.01 && iterations === 'infinite',
        ),
      ).toBe(true)
      expect(reduced).toEqual(
        normal.map(({ id, name }) => ({
          id,
          name,
          duration: expect.closeTo(0.01, 5),
          iterations: '1',
        })),
      )
      expect(restored).toEqual(normal)
    })
  },
  20_000,
)
