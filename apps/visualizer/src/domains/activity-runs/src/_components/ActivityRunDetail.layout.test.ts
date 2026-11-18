import { afterAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  closeBrowserSuite,
  openBrowserSuite,
  phoneViewport,
  settleTransitions,
  type TViewportTier,
  viewportWidths,
  withSuitePage,
} from '@/lib/testing'

/*
 * The context tab's panel used to be a `2fr / 3fr` grid with only one
 * child, so its content sat in the 2fr track at ~40% of the available
 * width while the chat, highlights and events tabs filled the panel. This
 * spins up the real Vite dev pipeline (same utilities, same component)
 * and measures actual layout in a real browser, because happy-dom does not
 * run a layout engine and cannot see this at all.
 */

const HARNESS_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<div id="root"></div>
<script type="module" src="/src/domains/activity-runs/src/_components/__fixtures__/activity-run-detail-harness.tsx"></script>
</body></html>`

const highContrastCss = readFileSync(
  new URL(
    '../../../../../../../templates/stamp/config/high-contrast.css',
    import.meta.url,
  ),
  'utf8',
)
const THEMES = [{ theme: 'Dark', scheme: 'dark' }] as const
const TABS = ['chat', 'highlights', 'context', 'events'] as const
const DETAIL = '#root main > section'
const CONTEXT = '[data-testid="activity-run-context"]'
const EVENTS = '[data-testid="activity-run-events"]'

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one browser and dev server per file; each test opens its own context
afterAll(() => closeBrowserSuite(suite), 30_000)

const withDetail = (
  tier: TViewportTier,
  check: (page: Page) => Promise<void>,
  query = '',
) => {
  return withSuitePage(suite)(
    {
      viewport: {
        width: viewportWidths[tier],
        height: phoneViewport.height,
      },
      reducedMotion: 'reduce',
    },
    async (page, { server, base }) => {
      page.setDefaultTimeout(5_000)
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname
        const body = path.endsWith('/themes')
          ? {
              themes: [
                ...['auto', 'dark', 'light'].map((name) => ({
                  name,
                  label: name[0]?.toUpperCase() + name.slice(1),
                  builtin: true,
                  css: '',
                })),
                {
                  name: 'high-contrast',
                  label: 'High contrast',
                  builtin: false,
                  css: highContrastCss,
                },
              ],
            }
          : path.endsWith('/prompts')
            ? {
                system: '# Instructions\n\nKeep every detail readable.',
                user: '# Request\n\nA compiled prompt.',
              }
            : []
        return route.fulfill({ json: body })
      })
      await page.route('**/__diag__/index.html*', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__diag__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(`${base}/__diag__/index.html${query}`)
      await page.getByRole('tab', { name: 'events' }).waitFor()
      await page.waitForFunction(() =>
        document
          .getElementById('crust-custom-themes')
          ?.textContent?.includes('high-contrast'),
      )
      await page.evaluate(() => document.fonts.ready)
      await check(page)
    },
  )
}

for (const tier of ['base', 'xl'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given the activity detail panel at the ${tier} tier`,
      'when each tab is opened and the context geometry is measured',
      'it should fill the panel without a grid split, maximum width, centering or horizontal overflow',
    ].join(', '),
    async () => {
      // given
      await withDetail(tier, async (page) => {
        // when
        for (const tab of TABS) {
          await page.getByRole('tab', { name: tab }).click()
          const overflow = await page.evaluate(() => ({
            document: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
          }))

          // then
          expect(overflow.document, `${tier}: ${tab}`).toBeLessThanOrEqual(
            overflow.viewport,
          )
        }
        await page.getByRole('tab', { name: 'context' }).click()
        const context = await page
          .getByTestId('activity-run-context')
          .evaluate((panel) => {
            const content = panel.firstElementChild
            if (!content) throw new Error('Missing context content')
            const style = getComputedStyle(panel)
            const childStyle = getComputedStyle(content)
            return {
              width: content.getBoundingClientRect().width,
              available:
                panel.clientWidth -
                Number.parseFloat(style.paddingLeft) -
                Number.parseFloat(style.paddingRight),
              offset:
                content.getBoundingClientRect().left -
                panel.getBoundingClientRect().left,
              padding: Number.parseFloat(style.paddingLeft),
              grid: style.gridTemplateColumns,
              maxWidth: style.maxWidth,
              childMaxWidth: childStyle.maxWidth,
              margins: [
                style.marginLeft,
                style.marginRight,
                childStyle.marginLeft,
                childStyle.marginRight,
              ],
            }
          })
        await page.getByRole('tab', { name: 'events' }).click()
        const events = await page
          .getByTestId('activity-run-events')
          .evaluate(
            (panel) => panel.firstElementChild?.getBoundingClientRect().width,
          )

        // then
        expect(Math.abs(context.width - context.available)).toBeLessThanOrEqual(
          0.5,
        )
        expect(Math.abs(context.offset - context.padding)).toBeLessThanOrEqual(
          0.5,
        )
        expect(events).toBeDefined()
        expect(
          Math.abs(context.width - (events ?? Number.NaN)),
        ).toBeLessThanOrEqual(0.5)
        expect(context.grid).toBe('none')
        expect(context.maxWidth).toBe('none')
        expect(context.childMaxWidth).toBe('none')
        expect(context.margins).toEqual(['0px', '0px', '0px', '0px'])
      })
    },
    30_000,
  )
}

test.skipIf(!browserTestsEnabled)(
  [
    'given the activity detail panel at the xl tier',
    'when only its parent narrows to the sm tier',
    'it should adapt its chat frame to its container while keeping one column and allowing growth',
  ].join(', '),
  async () => {
    // given
    await withDetail('xl', async (page) => {
      const chat = page.locator(`${DETAIL} > div`).filter({
        has: page.getByRole('heading', { name: 'thinking', exact: true }),
      })
      const row = chat.locator(':scope > div').first()
      // when
      const wide = await row.evaluate((element) => ({
        minHeight: getComputedStyle(element).minHeight,
        columns:
          getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
      }))
      await page
        .locator('#root')
        .evaluate(
          (element, width) => element.setAttribute('style', `width:${width}px`),
          viewportWidths.sm,
        )
      // Container-query styles settle at the next rendering opportunity.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      const narrow = await row.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        minHeight: getComputedStyle(element).minHeight,
        columns:
          getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
      }))

      // then
      expect(wide).toEqual({ minHeight: '512px', columns: 1 })
      expect(narrow.minHeight).toBe('384px')
      expect(narrow.columns).toBe(1)
      // when — variable content exceeds the former fixed-height frame.
      await row.evaluate((element) => {
        const content = document.createElement('p')
        content.setAttribute('style', 'min-height:64rem')
        element.firstElementChild?.append(content)
      })
      const expanded = await row.boundingBox()
      // then
      expect(expanded?.height).toBeGreaterThan(64 * 16)
    })
  },
  30_000,
)

const TYPE = ['font-family', 'font-size', 'font-weight', 'line-height']
const BORDER = ['border-top-color', 'border-top-width', 'border-top-style']
const WARNING = `${DETAIL} > div > div:has(> section > h5)`
const CONFIG = `${CONTEXT} > div > section:first-child > div > div`
const GATES = `${CONTEXT} > div > section:nth-child(4) > div`
const OUTPUTS = `${CONTEXT} > div > section:nth-child(6) > div`

// Independent legacy declarations, not expectations derived from utility names.
const legacyStyles = {
  chat: [
    {
      selector: DETAIL,
      css: 'background:var(--surface);border:var(--border-width) solid var(--border-soft)',
      properties: [...BORDER, 'background-color'],
    },
    {
      selector: `${DETAIL} > header`,
      css: 'display:flex;align-items:center;flex-wrap:wrap;background:var(--panel-2);border-bottom:var(--border-width) solid var(--border)',
      properties: [
        'display',
        'align-items',
        'flex-wrap',
        'background-color',
        'border-bottom-color',
        'border-bottom-width',
      ],
    },
    {
      selector: `${DETAIL} > header > div:first-child > span:first-child`,
      css: 'font-size:20px;font-weight:700',
      properties: TYPE,
    },
    {
      selector: `${DETAIL} > header > div:nth-child(2) > span`,
      css: 'display:inline-flex;align-items:baseline;background:var(--panel-3);border:var(--border-width) solid var(--border-soft);font-size:16px',
      properties: [
        ...TYPE,
        ...BORDER,
        'display',
        'align-items',
        'background-color',
      ],
    },
    {
      selector: `${DETAIL} > header > div:nth-child(2) > span > span:first-child`,
      css: 'color:var(--faint)',
      properties: ['color'],
    },
    {
      selector: `${DETAIL} > header > div:nth-child(2) > span > span:last-child`,
      css: 'color:var(--text)',
      properties: ['color'],
    },
    {
      selector: `${DETAIL} > header > button`,
      css: 'font-family:var(--mono);font-size:16px;color:var(--dim);background:none;border:var(--border-width) solid var(--border)',
      properties: [...TYPE, ...BORDER, 'color', 'background-color'],
    },
    {
      selector: `${DETAIL} [role="tab"][aria-selected="true"]`,
      css: 'font:inherit;font-size:.86rem;color:var(--text);border-bottom:2px solid var(--accent);background:none',
      properties: [
        ...TYPE,
        'color',
        'border-bottom-color',
        'border-bottom-width',
        'background-color',
      ],
    },
    {
      selector: `${DETAIL} h4`,
      css: 'margin:0;background:rgb(var(--panel-3-rgb)/.6);color:var(--faint);font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase',
      properties: [
        ...TYPE,
        'color',
        'background-color',
        'letter-spacing',
        'text-transform',
      ],
    },
  ],
  highlights: [
    {
      selector: WARNING,
      css: 'display:flex;flex-direction:column;background:var(--panel-2);border:var(--border-width) solid var(--border-soft);border-left:3px solid var(--amber)',
      properties: [
        ...BORDER,
        'display',
        'flex-direction',
        'background-color',
        'border-left-color',
        'border-left-width',
      ],
    },
    {
      selector: `${WARNING} h5`,
      css: 'margin:0;font-size:16px;font-weight:700;letter-spacing:.05em;text-transform:lowercase;color:var(--amber)',
      properties: [...TYPE, 'color', 'letter-spacing', 'text-transform'],
    },
    {
      selector: `${WARNING} li`,
      css: 'font-family:var(--mono);font-size:14px',
      properties: TYPE,
    },
    {
      selector: `${WARNING} p:last-child`,
      css: 'margin:0;font-size:14px;line-height:1.5;color:var(--dim)',
      properties: [...TYPE, 'color'],
    },
  ],
  context: [
    {
      selector: `${CONTEXT} > div > section:nth-child(3) > div > div > button`,
      css: 'font-size:16px;color:var(--text);background:none;border:none;display:flex;align-items:baseline;text-align:left',
      properties: [...TYPE, 'color', 'display', 'align-items', 'text-align'],
    },
    {
      selector: `${CONTEXT} > div > section:nth-child(3) > div > div > div > div > button:first-child`,
      css: 'font-family:var(--mono);font-size:16px;color:var(--text);border:var(--border-width) solid var(--border);background:var(--panel-2)',
      properties: [...TYPE, ...BORDER, 'color', 'background-color'],
    },
    {
      selector: `${GATES} > div:first-child > button`,
      css: 'font-size:16px;color:var(--text)',
      properties: [...TYPE, 'color'],
    },
    {
      selector: `${CONFIG} > div > span:first-child`,
      css: 'color:var(--faint)',
      properties: ['color'],
    },
    {
      selector: `${CONFIG} > div > span:nth-child(2)`,
      css: 'font-family:var(--mono);font-size:16px;background:rgb(var(--panel-2-rgb)/.6);border:var(--border-width) solid var(--border-soft)',
      properties: [...TYPE, ...BORDER, 'background-color'],
    },
    {
      selector: `${GATES} > div:first-child`,
      css: 'background:var(--panel-3);border:var(--border-width) solid var(--border-soft);border-left:3px solid var(--green)',
      properties: [
        ...BORDER,
        'background-color',
        'border-left-color',
        'border-left-width',
      ],
    },
    {
      selector: `${GATES} > div:last-child`,
      css: 'border-left:3px solid var(--red)',
      properties: ['border-left-color', 'border-left-width'],
    },
    {
      selector: `${GATES} > div:first-child > button > span:nth-child(2)`,
      css: 'color:var(--green)',
      properties: ['color'],
    },
    {
      selector: `${GATES} > div:last-child > button > span:nth-child(2)`,
      css: 'color:var(--red)',
      properties: ['color'],
    },
    {
      selector: `${GATES} > div:last-child > button > span:nth-child(4)`,
      css: 'background:var(--panel-3);border:var(--border-width) solid rgb(var(--fail-rgb)/.55)',
      properties: [...BORDER, 'background-color'],
    },
    {
      selector: `${GATES} > div:last-child > div > div:nth-child(1) > span:first-child`,
      css: 'color:var(--green)',
      properties: ['color'],
    },
    {
      selector: `${GATES} > div:last-child > div > div:nth-child(2) > span:first-child`,
      css: 'color:var(--red)',
      properties: ['color'],
    },
    {
      selector: `${CONTEXT} th:nth-child(2)`,
      css: 'font-family:var(--mono);font-size:14px;font-weight:400;letter-spacing:.06em;text-transform:uppercase;color:var(--text);text-align:right',
      properties: [
        ...TYPE,
        'color',
        'letter-spacing',
        'text-transform',
        'text-align',
      ],
    },
    {
      selector: `${CONTEXT} tbody > tr:nth-child(3) > td:first-child`,
      css: 'padding-left:18px;color:var(--faint)',
      properties: ['color', 'padding-left'],
    },
    {
      selector: `${CONTEXT} tbody > tr:last-child > td:first-child`,
      css: 'font-weight:700;color:var(--text);border-top:var(--border-width) solid var(--border-soft)',
      properties: [...BORDER, 'font-weight', 'color'],
    },
    {
      selector: `${OUTPUTS} > div:first-child > div > span:first-child`,
      css: 'font-weight:700;color:var(--purple)',
      properties: ['font-weight', 'color'],
    },
    {
      selector: `${OUTPUTS} > div:first-child > div > span:last-child`,
      css: 'color:var(--green)',
      properties: ['color'],
    },
    {
      selector: `${OUTPUTS} > div:last-child > div > span:last-child`,
      css: 'color:var(--red)',
      properties: ['color'],
    },
  ],
  events: [
    {
      selector: `${EVENTS} > div > div:first-child > button`,
      css: 'display:flex;align-items:baseline;font-family:var(--mono);font-size:16px;color:var(--text)',
      properties: [...TYPE, 'color', 'display', 'align-items'],
    },
    {
      selector: `${EVENTS} > div > div:first-child > button > span:nth-child(2)`,
      css: 'color:var(--purple)',
      properties: ['color'],
    },
    {
      selector: `${EVENTS} > div > div:nth-child(2) > button > span:nth-child(2)`,
      css: 'color:var(--cyan)',
      properties: ['color'],
    },
    {
      selector: `${EVENTS} > div > div:nth-child(3) > button > span:nth-child(3)`,
      css: 'color:var(--red)',
      properties: ['color'],
    },
    {
      selector: `${EVENTS} > div > div:nth-child(2) > div`,
      css: 'background:var(--panel-3);border:var(--border-width) solid var(--border)',
      properties: [...BORDER, 'background-color'],
    },
    {
      selector: `${EVENTS} > div > div:nth-child(2) > div h4`,
      css: 'font-size:16px;font-weight:700;color:var(--dim);letter-spacing:.06em;text-transform:lowercase',
      properties: [...TYPE, 'color', 'letter-spacing', 'text-transform'],
    },
    {
      selector: `${EVENTS} > div > div:nth-child(2) > div pre`,
      css: 'background:rgb(var(--bg-rgb)/.55);border:var(--border-width) solid var(--border-soft)',
      properties: [...BORDER, 'background-color'],
    },
  ],
}

const styleDifferences = (page: Page, tab: (typeof TABS)[number]) =>
  page.evaluate((cases) => {
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('Missing colour normalization canvas')
    const rgba = (color: string) => {
      canvas.clearRect(0, 0, 1, 1)
      // biome-ignore lint/plugin/no-object-mutation: the browser canvas exposes colour normalization through a setter.
      canvas.fillStyle = color
      canvas.fillRect(0, 0, 1, 1)
      const pixels = canvas.getImageData(0, 0, 1, 1).data
      return Array.from(pixels, (channel, index) =>
        index < 3 ? Math.round((channel * (pixels[3] ?? 0)) / 255) : channel,
      )
    }
    return cases.flatMap(({ selector, css, properties }) => {
      const element = document.querySelector(selector)
      if (!element)
        throw new Error(`Missing activity detail element: ${selector}`)
      const reference = element.cloneNode(false)
      if (!(reference instanceof Element))
        throw new Error('Missing reference element')
      reference.removeAttribute('class')
      // Issue #171: preserve the legacy native-button reference, not Preflight's inherited font.
      reference.setAttribute(
        'style',
        reference.matches('button') ? `font:revert;${css}` : css,
      )
      element.after(reference)
      try {
        return properties.flatMap((property) => {
          const actual = getComputedStyle(element).getPropertyValue(property)
          const expected =
            getComputedStyle(reference).getPropertyValue(property)
          const equal = property.endsWith('color')
            ? rgba(actual).every(
                (channel, index) =>
                  Math.abs(channel - (rgba(expected)[index] ?? Number.NaN)) <=
                  1,
              )
            : actual === expected
          return equal ? [] : [{ selector, property, actual, expected }]
        })
      } finally {
        reference.remove()
      }
    })
  }, legacyStyles[tab])

for (const { theme, scheme } of THEMES) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given the activity panel under ${theme} (${scheme}) at the xl tier`,
      'when every tab and its owned disclosures are opened',
      'it should retain legacy typography, colours, surfaces, grouping and alignment',
    ].join(', '),
    async () => {
      // given
      await withDetail('xl', async (page) => {
        // when
        await page.emulateMedia({ colorScheme: scheme })
        await page.getByRole('button', { name: /^Theme:/ }).click()
        await page.getByRole('option', { name: theme, exact: true }).click()
        await settleTransitions(page)
        for (const tab of TABS) {
          await page.getByRole('tab', { name: tab }).click()
          if (tab === 'context') {
            for (const name of [
              'agent config',
              'description',
              'compiled prompts',
              'gates',
              'cost',
              'outputs',
            ]) {
              await page
                .locator(CONTEXT)
                .getByRole('button', { name: new RegExp(name) })
                .click()
            }
            await page.getByRole('button', { name: /system prompt/ }).click()
            await page.getByRole('button', { name: /user prompt/ }).click()
            await page.locator(GATES).getByRole('button').first().click()
            await page.locator(GATES).getByRole('button').nth(1).click()
          }
          if (tab === 'events') {
            await page.locator(`${EVENTS} > div > div > button`).nth(1).click()
            await page.locator(`${EVENTS} > div > div > button`).nth(2).click()
          }
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          )

          // then
          expect(await styleDifferences(page, tab), `${theme}: ${tab}`).toEqual(
            [],
          )
          expect(
            await page
              .getByRole('tab', { name: tab })
              .getAttribute('aria-selected'),
          ).toBe('true')
          // when — review the same populated tab at the base and md tiers.
          for (const tier of ['base', 'md', 'xl'] as const) {
            await page.setViewportSize({
              width: viewportWidths[tier],
              height: phoneViewport.height,
            })
            const overflow = await page.evaluate(() => ({
              width: document.documentElement.scrollWidth,
              available: document.documentElement.clientWidth,
            }))
            // then
            expect(
              overflow.width,
              `${theme}: ${tab}: ${tier}`,
            ).toBeLessThanOrEqual(overflow.available)
          }
        }
      })
    },
    30_000,
  )
}

const gatesHeader = (page: Page) =>
  page
    .locator(`${CONTEXT} > div > section > button`)
    .filter({ hasText: 'gates' })

const gateRows = (page: Page) =>
  gatesHeader(page).locator('..').locator(':scope > div > div > button')

const gatesHeaderText = (page: Page) =>
  gatesHeader(page).evaluate((button) => button.textContent?.replace(/\s/g, ''))

for (const tier of ['base', 'xl'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given mixed gates at the ${tier} tier`,
      'when the context tab is opened and gates are expanded',
      'it should show exactly one verdict directly after the count in both states',
    ].join(', '),
    async () => {
      // given
      await withDetail(tier, async (page) => {
        // when
        await page.getByRole('tab', { name: 'context' }).click()
        const mark = page.getByTestId('gates-verdict')
        const placement = await mark.evaluate((element) => {
          const count = element.previousElementSibling
          if (!count) throw new Error('Missing gates count')
          const markBox = element.getBoundingClientRect()
          const countBox = count.getBoundingClientRect()
          return {
            previousTag: count.tagName,
            previousText: count.textContent,
            last: element.parentElement?.lastElementChild === element,
            after: markBox.left >= countBox.right,
            overlaps:
              markBox.top < countBox.bottom && markBox.bottom > countBox.top,
          }
        })

        // then
        expect(await gateRows(page).count()).toBe(0)
        expect(await mark.count()).toBe(1)
        expect(await mark.isVisible()).toBe(true)
        expect(await gatesHeaderText(page)).toBe('▸gates(2)✗')
        expect(placement).toEqual({
          previousTag: 'SPAN',
          previousText: '(2)',
          last: true,
          after: true,
          overlaps: true,
        })

        // when
        await gatesHeader(page).click()

        // then
        expect(await gateRows(page).count()).toBe(2)
        for (const row of await gateRows(page).all())
          expect(await row.isVisible()).toBe(true)
        expect(await mark.count()).toBe(1)
        expect(await mark.isVisible()).toBe(true)
        expect(await gatesHeaderText(page)).toBe('▾gates(2)✗')
      })
    },
    30_000,
  )
}

for (const { name, query, rowIndex, headerText } of [
  { name: 'mixed', query: '', rowIndex: 1, headerText: '▾gates(2)✗' },
  {
    name: 'passing',
    query: '?gates=passed',
    rowIndex: 0,
    headerText: '▾gates(2)✓',
  },
]) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given ${name} gates at the xl tier`,
      'when gates are expanded and each selectable theme is chosen',
      'it should match the row mark character, colour and weight',
    ].join(', '),
    async () => {
      // given
      await withDetail(
        'xl',
        async (page) => {
          // when
          await page.getByRole('tab', { name: 'context' }).click()
          await gatesHeader(page).click()
          for (const theme of ['Dark', 'Light', 'High contrast']) {
            await page.getByRole('button', { name: /^Theme:/ }).click()
            await page.getByRole('option', { name: theme, exact: true }).click()
            await settleTransitions(page)
            const header = await page
              .getByTestId('gates-verdict')
              .evaluate((element) => ({
                text: element.textContent,
                color: getComputedStyle(element).color,
                weight: getComputedStyle(element).fontWeight,
              }))
            const row = await gateRows(page)
              .nth(rowIndex)
              .locator(':scope > span:nth-child(2)')
              .evaluate((element) => ({
                text: element.textContent,
                color: getComputedStyle(element).color,
                weight: getComputedStyle(element).fontWeight,
              }))

            // then
            expect(header, theme).toEqual(row)
            expect(row.weight, theme).toBe('400')
            expect(await gatesHeaderText(page)).toBe(headerText)
          }
        },
        query,
      )
    },
    30_000,
  )
}

test.skipIf(!browserTestsEnabled)(
  [
    'given a gate with no recorded verdict at the xl tier',
    'when the context gates are expanded',
    'it should show the failure mark on both the row and header',
  ].join(', '),
  async () => {
    // given
    await withDetail(
      'xl',
      async (page) => {
        // when
        await page.getByRole('tab', { name: 'context' }).click()
        await gatesHeader(page).click()

        // then
        expect(await gateRows(page).count()).toBe(1)
        expect(
          await gateRows(page)
            .locator(':scope > span:nth-child(2)')
            .textContent(),
        ).toBe('✗')
        expect(await gatesHeaderText(page)).toBe('▾gates(1)✗')
      },
      '?gates=unrecorded',
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given no gate results at the xl tier',
    'when the context tab is opened and gates are expanded',
    'it should show a zero count and no verdict in either state',
  ].join(', '),
  async () => {
    // given
    await withDetail(
      'xl',
      async (page) => {
        // when
        await page.getByRole('tab', { name: 'context' }).click()

        // then
        expect(await gatesHeaderText(page)).toBe('▸gates(0)')
        expect(await page.getByTestId('gates-verdict').count()).toBe(0)

        // when
        await gatesHeader(page).click()

        // then
        expect(
          await page.getByText('no gate results', { exact: true }).isVisible(),
        ).toBe(true)
        expect(await gatesHeaderText(page)).toBe('▾gates(0)')
        expect(await page.getByTestId('gates-verdict').count()).toBe(0)
      },
      '?gates=none',
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given passing gates at the xl tier',
    'when another activity with a failing gate is selected',
    'it should change the header verdict without reloading',
  ].join(', '),
  async () => {
    // given
    await withDetail(
      'xl',
      async (page) => {
        await page.getByRole('tab', { name: 'context' }).click()
        expect(await gatesHeaderText(page)).toBe('▸gates(2)✓')
        const origin = await page.evaluate(() => performance.timeOrigin)

        // when
        await page.evaluate(
          "window.dispatchEvent(new CustomEvent('fixture:select-activity', { detail: 'ar-diag-2' }))",
        )
        await page.getByRole('tab', { name: 'context' }).click()

        // then
        expect(await gatesHeaderText(page)).toBe('▸gates(1)✗')
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
      },
      '?gates=passed',
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given expanded passing gates at the xl tier',
    'when a failing result arrives',
    'it should change the verdict in the first snapshot listing the new row without reloading',
  ].join(', '),
  async () => {
    // given
    await withDetail(
      'xl',
      async (page) => {
        await page.getByRole('tab', { name: 'context' }).click()
        await gatesHeader(page).click()
        expect(await gatesHeaderText(page)).toBe('▾gates(2)✓')
        const origin = await page.evaluate(() => performance.timeOrigin)

        // when
        await page.evaluate(
          "window.dispatchEvent(new CustomEvent('fixture:record-failed-gate'))",
        )
        const snapshot = await page.waitForFunction(() => {
          const header = document.querySelector(
            '[data-testid="gates-verdict"]',
          )?.parentElement
          const rows = header?.parentElement?.querySelectorAll(
            ':scope > div > div > button',
          )
          if (rows?.length !== 3) return false
          return {
            mark: rows[2]?.querySelector(':scope > span:nth-child(2)')
              ?.textContent,
            header: header?.textContent?.replace(/\s/g, ''),
          }
        })

        // then
        expect(await snapshot.jsonValue()).toEqual({
          mark: '✗',
          header: '▾gates(3)✗',
        })
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
      },
      '?gates=passed',
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given the default activity context at the xl tier',
    'when the section headers are inspected',
    'it should show no overall result marks outside gates',
  ].join(', '),
  async () => {
    // given
    await withDetail('xl', async (page) => {
      // when
      await page.getByRole('tab', { name: 'context' }).click()
      const headers = page.locator(`${CONTEXT} > div > section > button`)
      const others = headers.filter({ hasNotText: 'gates' })

      // then
      expect(await headers.count()).toBeGreaterThanOrEqual(4)
      for (const header of await others.all()) {
        expect(
          await header.locator('[data-testid="gates-verdict"]').count(),
        ).toBe(0)
        expect(await header.textContent()).not.toMatch(/[✓✗]/)
      }
    })
  },
  30_000,
)
