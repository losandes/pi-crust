import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { chromium, devices, type Page } from 'playwright'
import {
  startHarnessServer,
  type TViewportTier,
  viewportWidths,
} from '@/lib/testing'

const probe = await chromium.launch().catch(() => undefined)
const hasChromium = probe !== undefined
await probe?.close()
if (!hasChromium) {
  console.warn(
    'HandoffControls.layout.test.ts: no Chromium — skipping browser checks. Run `bunx playwright install chromium`.',
  )
}

const registeredTheme = {
  name: 'high-contrast',
  label: 'High contrast',
  builtin: false,
  css: readFileSync(
    new URL(
      '../../../../../../../templates/stamp/config/high-contrast.css',
      import.meta.url,
    ),
    'utf8',
  ),
}
const markdown = [
  '# Handoff document',
  'A paragraph with **emphasis** and `inline code`.',
  '- First item\n- Second item',
  '1. Ordered item\n2. Another item',
  '> A quoted instruction.',
  '| Choice | Outcome |\n| --- | --- |\n| Keep | Readable |\n| Retry | Visible |',
  ['```text', 'long-code-token'.repeat(40), '```'].join('\n'),
].join('\n\n')

const HARNESS_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<select id="theme"><option>dark</option><option>light</option><option>auto</option><option>high-contrast</option></select>
<div id="root" class="@container mx-auto max-w-6xl"></div>
<script type="module">
import { createElement as h, Fragment, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/style.css'
import { applyCustomThemes, applyTheme } from '/src/domains/themes/index.ts'
import { ArtifactList } from '/src/domains/handoff/src/_components/ArtifactList.tsx'
import { DocumentViewer } from '/src/domains/handoff/src/_components/DocumentViewer.tsx'
import { SessionContext } from '/src/domains/handoff/src/_components/SessionContext.tsx'
import { RunControls } from '/src/domains/run-controls/src/_components/RunControls.tsx'
applyCustomThemes(document, [${JSON.stringify(registeredTheme)}])
applyTheme(document.documentElement, 'dark', window.matchMedia)
document.getElementById('theme').addEventListener('change', (event) => {
  applyTheme(document.documentElement, event.target.value, window.matchMedia)
})
const artifacts = ['reported', 'observed', 'system', 'missing'].map((source) => ({
  path: 'context_handoff/' + source + '-' + 'long-path'.repeat(10) + '.md',
  name: source + '.md', title: source + ' document', source,
  summary: 'An artifact summary that stays readable when its panel narrows.',
  notes: '',
}))
function Fixture() {
  const [viewing, setViewing] = useState(undefined)
  return h(Fragment, undefined,
    h('div', { id: 'artifacts' }, h(ArtifactList, { artifacts, onOpen: setViewing })),
    h(DocumentViewer, { artifact: viewing, runId: 'fixture', onClose: () => setViewing(undefined) }),
    ...['running', 'waiting', 'fail', 'success'].map((status) => h('div', { id: status, key: status },
      h(RunControls, {
        runId: 'fixture', status, consultStep: 'build', replaying: ['build', 'review'],
        sendDecision: async () => ({ ok: true, data: {} }),
      }))),
    h(SessionContext, {
      session: { request: ${JSON.stringify(markdown)} }, runId: 'fixture', envelopes: [], events: [],
    }))
}
createRoot(document.getElementById('root')).render(h(Fixture))
</script></body></html>`

const withComponents = async (
  tier: TViewportTier,
  check: (page: Page) => Promise<void>,
) => {
  const { server, base } = await startHarnessServer()
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: {
          width: viewportWidths[tier],
          height: devices['iPhone SE'].viewport.height,
        },
        reducedMotion: 'reduce',
      })
      page.setDefaultTimeout(5_000)
      // Every API request is intercepted: no live run or database is touched.
      await page.route('**/api/**', (route) =>
        new URL(route.request().url()).pathname.includes('/handoff/')
          ? route.fulfill({ contentType: 'text/plain', body: markdown })
          : route.fulfill({ json: [] }),
      )
      await page.route('**/__handoff__/index.html', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__handoff__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(`${base}/__handoff__/index.html`)
      await page.locator('#artifacts [role="button"]').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await check(page)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

const expectLegacyPaint = async (page: Page) => {
  const comparisons = await page.evaluate(() => {
    // These are the former modules' computed winning declarations, including
    // `.actions button` taking precedence over primary/danger/amend colours.
    const cases = [
      {
        selector: '#running section',
        css: 'background:var(--surface);border:var(--border-width) solid rgb(var(--waiting-rgb) / var(--edge-alpha));color:var(--text);font-family:var(--sans)',
      },
      {
        selector: '#running button',
        css: 'background:var(--panel-2);border:var(--border-width) solid var(--border);color:var(--dim);font-family:var(--sans)',
      },
      {
        selector: '#artifacts [role="button"]:nth-child(3)',
        css: 'background:var(--panel-2);border:var(--border-width) solid var(--border-soft);color:var(--text);font-family:var(--card-sans);opacity:0.62',
      },
      {
        selector:
          '#artifacts [aria-disabled="true"] > span:first-child > span:last-child',
        css: 'color:var(--text);font-family:var(--card-sans)',
      },
      {
        selector: '#artifacts [aria-disabled="true"] > span:last-child',
        css: 'color:var(--red);font-family:var(--card-sans)',
      },
      {
        selector: 'dialog[open] > div',
        css: 'background:var(--surface);border:var(--border-width) solid var(--border);color:var(--text);font-family:var(--sans)',
      },
      {
        selector: 'dialog[open] a',
        css: 'background:transparent;border:var(--border-width) solid var(--border-soft);color:var(--dim);font-family:var(--mono)',
      },
    ]
    const rgba = (color: string) => {
      const context = document.createElement('canvas').getContext('2d')
      if (!context) throw new Error('Canvas colour comparison unavailable')
      // biome-ignore lint/plugin/no-object-mutation: the canvas API accepts CSS colours through its fillStyle setter.
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const paint = (element: Element) => {
      const style = getComputedStyle(element)
      return {
        color: rgba(style.color),
        background: rgba(style.backgroundColor),
        backgroundImage: style.backgroundImage,
        border: rgba(style.borderTopColor),
        borderWidth: style.borderTopWidth,
        font: style.fontFamily,
        opacity: style.opacity,
      }
    }
    return cases.map(({ selector, css }) => {
      const actual = document.querySelector(selector)
      if (!actual) throw new Error(`Missing paint target: ${selector}`)
      const reference = document.createElement('div')
      reference.setAttribute('style', css)
      document.body.appendChild(reference)
      const result = {
        selector,
        actual: paint(actual),
        expected: paint(reference),
      }
      reference.remove()
      return result
    })
  })
  for (const { selector, actual, expected } of comparisons)
    expect(actual, selector).toEqual(expected)
}

const expectNoOverflow = async (page: Page) => {
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(widths.content).toBeLessThanOrEqual(widths.viewport)
}

for (const tier of Object.keys(viewportWidths) as TViewportTier[]) {
  test.skipIf(!hasChromium)(
    [
      `given handoff and run controls at the ${tier} tier`,
      'when all themes and both dialogs are displayed',
      'it should retain readable content without document overflow',
    ].join(', '),
    async () => {
      // given
      await withComponents(tier, async (page) => {
        for (const { theme, scheme } of [
          { theme: 'dark', scheme: 'dark' },
          { theme: 'light', scheme: 'light' },
          { theme: 'auto', scheme: 'dark' },
          { theme: 'auto', scheme: 'light' },
          { theme: 'high-contrast', scheme: 'dark' },
        ] as const) {
          // when
          await page.emulateMedia({ colorScheme: scheme })
          await page.selectOption('#theme', theme)
          // Wait for this opening's fetch, not the previous document's DOM.
          const loaded = page.waitForResponse((response) =>
            new URL(response.url()).pathname.includes('/handoff/'),
          )
          await page.locator('#artifacts [role="button"]').first().click()
          await loaded
          const viewer = page.getByRole('dialog', { name: 'reported document' })
          await viewer.locator('table').waitFor()

          // then
          await expectLegacyPaint(page)
          await expectNoOverflow(page)
          expect(
            await viewer
              .locator('ul')
              .evaluate((element) => getComputedStyle(element).listStyleType),
          ).toBe('disc')
          expect(
            await viewer
              .locator('ol')
              .evaluate((element) => getComputedStyle(element).listStyleType),
          ).toBe('decimal')
          const panel = await viewer
            .locator(':scope > div')
            .evaluate((element) => ({
              content: element.scrollWidth,
              available: element.clientWidth,
            }))
          expect(panel.content).toBeLessThanOrEqual(panel.available)
          await page.keyboard.press('Escape')
          await page.locator('#fail textarea').focus()
          await page.keyboard.press('ControlOrMeta+A')
          await page.keyboard.insertText('Keep every document readable.')
          await page
            .locator('#fail')
            .getByRole('button', { name: 'steer from here…' })
            .click()
          const steering = page
            .getByRole('dialog')
            .filter({ hasText: 'Send this run back to build' })
          expect(await steering.getByRole('button').count()).toBe(3)
          await expectNoOverflow(page)
          await page.keyboard.press('Escape')
        }
      })
    },
    60_000,
  )
}

test.skipIf(!hasChromium)(
  [
    'given the amend action at the xl tier',
    'when hovered under each supported theme',
    'it should retain the legacy neutral border colour',
  ].join(', '),
  async () => {
    // given
    await withComponents('xl', async (page) => {
      const amend = page.locator('#success').getByRole('button', {
        name: "amend this activity's document",
        exact: true,
      })
      for (const { theme, scheme } of [
        { theme: 'dark', scheme: 'dark' },
        { theme: 'light', scheme: 'light' },
        { theme: 'auto', scheme: 'dark' },
        { theme: 'auto', scheme: 'light' },
        { theme: 'high-contrast', scheme: 'dark' },
      ] as const) {
        // when
        await page.emulateMedia({ colorScheme: scheme })
        await page.selectOption('#theme', theme)
        await amend.hover()
        const paint = await amend.evaluate((element) => {
          const reference = document.createElement('span')
          reference.style.setProperty('color', 'var(--border)')
          element.after(reference)
          const result = {
            actual: getComputedStyle(element).borderTopColor,
            expected: getComputedStyle(reference).color,
          }
          reference.remove()
          return result
        })

        // then
        expect(paint.actual, `${theme}: ${scheme}`).toBe(paint.expected)
      }
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given handoff and run dialogs in a narrow parent at the xl tier',
    'when opened and dismissed using only the keyboard',
    'it should expose the same actions and restore focus without submitting a write',
  ].join(', '),
  async () => {
    // given
    await withComponents('xl', async (page) => {
      await page.locator('#root').evaluate((element, width) => {
        element.style.setProperty('max-width', `${width}px`)
      }, viewportWidths.base)
      const card = page.locator('#artifacts [role="button"]').first()
      await card.focus()

      // when
      await page.keyboard.press('Enter')
      const viewer = page.getByRole('dialog', { name: 'reported document' })
      await viewer.locator('table').waitFor()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')

      // then
      expect(
        await viewer
          .getByRole('button', { name: 'close', exact: true })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true)
      await page.keyboard.press('Enter')
      expect(
        await card.evaluate((element) => element === document.activeElement),
      ).toBe(true)
      await expectNoOverflow(page)

      // when
      await page.locator('#fail textarea').focus()
      await page.keyboard.insertText('Keep every document readable.')
      await page
        .locator('#fail')
        .getByRole('button', { name: 'steer from here…' })
        .focus()
      await page.keyboard.press('Enter')
      const steering = page
        .getByRole('dialog')
        .filter({ hasText: 'Send this run back to build' })

      // then
      expect(
        await steering
          .getByRole('button', { name: 'cancel', exact: true })
          .evaluate((element) => element === document.activeElement),
      ).toBe(true)
      await page.keyboard.press('Enter')
      expect(await steering.isVisible()).toBe(false)
      await page
        .locator('#running')
        .getByRole('button', { name: 'abort', exact: true })
        .focus()
      await page.keyboard.press('Enter')
      await page
        .getByRole('dialog')
        .filter({ hasText: 'abort this run?' })
        .waitFor()
      await page.keyboard.press('Escape')
      expect(await page.locator('dialog[open]').count()).toBe(0)
    })
  },
  30_000,
)
