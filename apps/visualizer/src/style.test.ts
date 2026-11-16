import { afterAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  buildProductionCss,
  closeBrowserSuite,
  openBrowserSuite,
  phoneViewport,
  settleTransitions,
  viewportWidths,
  withSuitePage,
} from '@/lib/testing'

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
  'on-blue': 'text-on-blue bg-on-blue border-on-blue',
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
${COLOR_PROBES}
<button id="utility-control" class="font-sans">Utility control</button>
${THEME_PROBES}
<div id="rendered-prose">
  <h1>Heading</h1>
  <ul><li>Bullet</li></ul>
  <ol><li>Number</li></ol>
</div>
<menu id="preflight-list"><li>Unstyled</li></menu>
<span id="spinner"><span id="spinner-icon" data-animation></span></span>
<span id="activity" class="animate-[crust-pulse_1.2s_ease-in-out_infinite]" data-animation>Running</span>
<span id="card-dot" class="animate-[crust-pulse_1.4s_ease-in-out_infinite]" data-animation></span>
<span id="trace-status" class="animate-[crust-pulse_1.2s_ease-in-out_infinite]" data-animation>Running</span>
<button id="trace-block" class="animate-[crust-pulse_1.6s_ease-in-out_infinite]" data-animation>Activity</button>
<span id="live-dot" class="animate-[crust-pulse_1.6s_ease-in-out_infinite]" data-animation></span>
<script type="module">
import '/src/style.css'
import { applyCustomThemes, applyTheme } from '/src/domains/themes/index.ts'
import { Prose, StatusChip } from '/src/lib/_components/index.ts'
import { NarrationPane } from '/src/domains/narration/index.ts'
import { DecisionLedger, DecisionRequest } from '/src/domains/decisions/index.ts'
import { renderMarkdown } from '/src/lib/markdown/index.ts'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
const narrationProps = {
  events: [], agent: 'builder', activityRunStatus: 'success', runId: 'fixture', runStatus: 'success',
  consults: [{ at: '2026-01-01', question: 'Question ' + 'long'.repeat(100), mode: 'consult', answer: '\\x60\\x60\\x60json\\n{"ok":true}\\n\\x60\\x60\\x60', amended: ['answer'], restored: ['other'] }],
  pending: { mode: 'consult', question: 'Still waiting' },
  envelope: { payload_json: JSON.stringify({ summary: 'Its final answer' }) },
}
if (location.search === '?surfaces') {
  const surface = document.createElement('main')
  surface.id = 'migration-surfaces'
  surface.className = 'min-w-0'
  document.body.append(surface)
  const prose = '# Waiting for you\\n\\nParagraph with **emphasis** and \\x60inline code\\x60.\\n\\n## More\\n\\n### Details\\n\\n#### Small heading\\n\\n- Bullet\\n\\n1. Number\\n\\n> Quoted\\n\\n---\\n\\n\\x60\\x60\\x60json\\n{"long":"' + 'long'.repeat(100) + '"}\\n\\x60\\x60\\x60\\n\\n| First | Second |\\n| --- | --- |\\n| One | Two |\\n| Three | Four |'
  const wrap = (id, component) => createElement('div', { id, key: id }, component)
  createRoot(surface).render(createElement('div', {}, [
    wrap('narration-surface', createElement(NarrationPane, narrationProps)),
    wrap('failed-narration', createElement(NarrationPane, { ...narrationProps, activityRunStatus: 'fail' })),
    wrap('open-narration', createElement(NarrationPane, {
      ...narrationProps,
      consults: [{ ...narrationProps.consults[0], answer: '\\x60\\x60\\x60json\\n{"pending":true}' }],
    })),
    wrap('ledger-surface', createElement(DecisionLedger, { ledger: {
      total: 5,
      questions: ['escalated', 'open', 'decided'].map(outcome => ({ outcome, question: outcome + ' question', provisional_answer: outcome === 'open' ? '' : 'A defensible answer', consequential: true, beyond_this_run: true })),
      decisions: [{ decision: 'Decision', rationale: 'Evidence' }],
      assumptions: [{ assumption: 'Assumption', invalidated_by: 'Counterexample' }],
    } })),
    wrap('inline-request', createElement(DecisionRequest, { runId: 'fixture', status: 'waiting' })),
    wrap('standalone-request', createElement(DecisionRequest, { runId: 'fixture', status: 'waiting', standalone: true })),
    wrap('default-prose', createElement(Prose, { html: renderMarkdown(prose) })),
    wrap('compact-prose', createElement(Prose, { html: renderMarkdown(prose), variant: 'compact' })),
  ]))
}
applyCustomThemes(document, [${JSON.stringify(registeredTheme)}])
applyTheme(document.documentElement, 'dark', window.matchMedia)
document.getElementById('theme-choice').addEventListener('change', (event) => {
  applyTheme(document.documentElement, event.target.value, window.matchMedia)
})
const runningChip = StatusChip({ status: 'running' })
const classes = {
  spinner: [runningChip.props.className],
  'spinner-icon': [runningChip.props.children[0].props.className],
  'rendered-prose': [Prose({ html: '', variant: 'default' }).props.className],
}
for (const [id, names] of Object.entries(classes)) {
  document.getElementById(id).className = names.join(' ')
}
document.documentElement.setAttribute('data-ready', 'true')
</script>
</body></html>`

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one browser and dev server per file; each test opens its own context
afterAll(() => closeBrowserSuite(suite), 30_000)

const withStyles = (check: (page: Page) => Promise<void>, surfaces = false) => {
  return withSuitePage(suite)(
    {
      viewport: {
        width: viewportWidths.xl,
        height: phoneViewport.height,
      },
    },
    async (page, { server, base }) => {
      // Leave time for context teardown before Bun's test timeout.
      page.setDefaultTimeout(8_000)
      page.setDefaultNavigationTimeout(8_000)
      await page.route('**/api/**', (route) =>
        route.fulfill({
          json: {
            present: true,
            markdown: '# Waiting for you\n\nPlease decide.\n\n- One\n- Two',
          },
        }),
      )
      await page.route(
        /\/__styles__\/index\.html(?:\?surfaces)?$/,
        async (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: await server.transformIndexHtml(
              '/__styles__/index.html',
              HARNESS_HTML,
            ),
          }),
      )
      await page.goto(
        `${base}/__styles__/index.html${surfaces ? '?surfaces' : ''}`,
      )
      await page.waitForSelector('[data-ready="true"]')
      if (surfaces) {
        await page.locator('#standalone-request section').waitFor()
        await page
          .locator('body > :not(#migration-surfaces):not(#theme-choice)')
          .evaluateAll((elements) => {
            for (const element of elements) element.remove()
          })
      }
      await check(page)
    },
  )
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

for (const theme of ['dark']) {
  test.skipIf(!browserTestsEnabled)(
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
        await settleTransitions(page)
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
}

for (const theme of ['dark']) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given narration, decisions and both Prose variants under ${theme}`,
      'when the real components render across the named viewport tiers',
      'it should preserve semantic colours, reading faces, grouping and markdown without horizontal overflow',
    ].join(', '),
    async () => {
      // given
      await withStyles(async (page) => {
        await page.emulateMedia({ colorScheme: 'light' })
        await page.selectOption('#theme-choice', theme)
        await settleTransitions(page)

        // when
        const appearance = await page.evaluate(() => {
          const canvas = document.createElement('canvas').getContext('2d')
          if (!canvas) throw new Error('Missing colour normalization canvas')
          const rgba = (value: string) => {
            canvas.clearRect(0, 0, 1, 1)
            // biome-ignore lint/plugin/no-object-mutation: the browser canvas exposes colour normalization through a setter.
            canvas.fillStyle = value
            canvas.fillRect(0, 0, 1, 1)
            const pixels = canvas.getImageData(0, 0, 1, 1).data
            return Array.from(pixels, (channel, index) =>
              index < 3
                ? Math.round((channel * (pixels[3] ?? 0)) / 255)
                : channel,
            )
          }
          const cases = [
            ['#standalone-request section', 'margin-left', 'margin-left:28px'],
            [
              '#standalone-request section',
              'margin-right',
              'margin-right:28px',
            ],
            [
              '#open-narration pre',
              'border-left-style',
              'border-left-style:dashed',
            ],
            [
              '#open-narration pre',
              'border-left-width',
              'border-left-width:3px',
            ],
            [
              '#narration-surface pre',
              'border-left-width',
              'border-left-width:0px',
            ],
            [
              '#narration-surface article',
              'background-color',
              'background:var(--blue)',
            ],
            ['#narration-surface article', 'color', 'color:var(--on-blue)'],
            [
              '#narration-surface article',
              'font-family',
              'font-family:var(--card-sans)',
            ],
            [
              '#narration-surface article > span',
              'font-family',
              'font-family:var(--mono)',
            ],
            [
              '#narration-surface pre',
              'background-color',
              'background:transparent',
            ],
            [
              '#narration-surface pre',
              'font-family',
              'font-family:var(--mono)',
            ],
            ['#narration-surface pre code', 'font-size', 'font:inherit'],
            [
              '#narration-surface [class*="border-l-ok"]',
              'background-color',
              'background:rgb(var(--ok-rgb)/.07)',
            ],
            [
              '#failed-narration [class*="border-l-fail"]',
              'background-color',
              'background:rgb(var(--fail-rgb)/.07)',
            ],
            [
              '#ledger-surface article',
              'background-color',
              'background:rgb(var(--waiting-rgb)/.07)',
            ],
            [
              '#ledger-surface article',
              'border-left-color',
              'border-left:3px solid var(--waiting)',
            ],
            [
              '#ledger-surface article > header > span',
              'color',
              'color:var(--waiting)',
            ],
            [
              '#ledger-surface section:first-child article:nth-of-type(2)',
              'border-left-color',
              'border-left:3px solid var(--warn)',
            ],
            [
              '#ledger-surface section:first-child article:nth-of-type(3)',
              'border-left-color',
              'border-left:3px solid rgb(var(--ok-rgb)/.7)',
            ],
            [
              '#inline-request section',
              'background-color',
              'background:transparent',
            ],
            [
              '#inline-request section',
              'border-left-color',
              'border-left:3px solid var(--waiting)',
            ],
            ['#inline-request h1', 'color', 'color:var(--waiting)'],
            ['#standalone-request h1', 'color', 'color:var(--waiting)'],
            [
              '#default-prose > div',
              'font-family',
              'font-family:var(--card-sans)',
            ],
            ['#default-prose > div', 'color', 'color:var(--text)'],
            ['#default-prose h1', 'font-weight', 'font-weight:bold'],
            ['#default-prose blockquote', 'color', 'color:var(--dim)'],
            [
              '#default-prose pre',
              'background-color',
              'background:var(--panel-3)',
            ],
            ['#default-prose pre', 'white-space', 'white-space:pre'],
            [
              '#default-prose pre code',
              'background-color',
              'background:transparent',
            ],
            [
              '#compact-prose > div',
              'font-family',
              'font-family:var(--card-sans)',
            ],
            ['#compact-prose > div', 'color', 'color:var(--text)'],
            ['#compact-prose h1', 'color', 'color:var(--waiting)'],
            [
              '#compact-prose pre',
              'background-color',
              'background:transparent',
            ],
            ['#compact-prose blockquote', 'color', 'color:var(--text)'],
            [
              '#default-prose th',
              'background-color',
              'background:var(--table-head)',
            ],
            [
              '#compact-prose th',
              'background-color',
              'background:var(--table-head)',
            ],
            [
              '#default-prose tbody tr:nth-child(even)',
              'background-color',
              'background:var(--zebra)',
            ],
            [
              '#compact-prose tbody tr:nth-child(even)',
              'background-color',
              'background:var(--zebra)',
            ],
          ]
          return cases.flatMap(([selector, property, css]) => {
            if (!(selector && property && css))
              throw new Error('Incomplete appearance case')
            const element = document.querySelector(selector)
            if (!element)
              throw new Error(`Missing migrated element: ${selector}`)
            const reference = document.createElement(element.tagName)
            reference.setAttribute('style', css)
            element.after(reference)
            try {
              const actual =
                getComputedStyle(element).getPropertyValue(property)
              const expected =
                getComputedStyle(reference).getPropertyValue(property)
              const matches = property.endsWith('color')
                ? rgba(actual).every(
                    (channel, index) =>
                      Math.abs(channel - (rgba(expected)[index] ?? -255)) <= 1,
                  )
                : actual === expected
              return matches ? [] : [{ selector, property, actual, expected }]
            } finally {
              reference.remove()
            }
          })
        })

        // then
        expect(appearance).toEqual([])
        const sizes = await page
          .locator('#default-prose > div, #compact-prose > div')
          .evaluateAll((elements) =>
            elements.map((element) =>
              Number.parseFloat(getComputedStyle(element).fontSize),
            ),
          )
        expect(sizes).toEqual([16, 14])
        for (const tier of Object.keys(
          viewportWidths,
        ) as (keyof typeof viewportWidths)[]) {
          await page.setViewportSize({
            width: viewportWidths[tier],
            height: phoneViewport.height,
          })
          const geometry = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            available: document.documentElement.clientWidth,
          }))
          expect(geometry.width, `${theme}: ${tier}`).toBeLessThanOrEqual(
            geometry.available,
          )
        }
        for (const id of ['default-prose', 'compact-prose']) {
          const markers = await page
            .locator(`#${id} ul, #${id} ol`)
            .evaluateAll((elements) =>
              elements.map(
                (element) => getComputedStyle(element).listStyleType,
              ),
            )
          expect(markers).toEqual(['disc', 'decimal'])
        }
      }, true)
    },
    30_000,
  )
}

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

test.skipIf(!browserTestsEnabled)(
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
      await settleTransitions(page)
      const [light, lightReference] = await readColors()
      await page.emulateMedia({ colorScheme: 'light' })
      await page.selectOption('#theme-choice', 'auto')
      await settleTransitions(page)
      const [auto] = await readColors()
      await page.selectOption('#theme-choice', 'high-contrast')
      await settleTransitions(page)
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

test.skipIf(!browserTestsEnabled)(
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
        .locator('#rendered-prose ul, #rendered-prose ol, #preflight-list')
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).listStyleType),
        )
      const headingWeight = await page
        .locator('#rendered-prose h1')
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

test.skipIf(!browserTestsEnabled)(
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

test.skipIf(!browserTestsEnabled)(
  [
    'given issue #85 production CSS at the xl tier',
    'when themes change after the build and descendants override semantic variables',
    'it should keep colour utilities, fonts and opacity modifiers live',
  ].join(', '),
  async () => {
    // given — requirements 1.1.2–1.1.4, 1.3.1–1.3.3 and target state 2.1
    const css = await buildProductionCss()
    expect(css).not.toBe('')
    await withSuitePage(suite)(
      {
        viewport: {
          width: viewportWidths.xl,
          height: phoneViewport.height,
        },
      },
      async (page) => {
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
        await settleTransitions(page)
        const light = await readColorProbes(page)
        await page.locator('html').evaluate((element) => {
          element.setAttribute('data-theme', 'high-contrast')
        })
        await settleTransitions(page)
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
            elements.map(
              (element) => getComputedStyle(element).backgroundColor,
            ),
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
      },
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
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
