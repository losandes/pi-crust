import { afterAll, expect, test } from 'bun:test'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  closeBrowserSuite,
  openBrowserSuite,
  phoneViewport,
  type TViewportTier,
  viewportWidths,
  withSuitePage,
} from '@/lib/testing'

const HARNESS_HTML = `<!doctype html>
<html><body><div id="app"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/sessions-list-harness.tsx"></script>
</body></html>`

const CARDS = 'main a[href*="dashboard-"]'

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one browser and dev server per file; each test opens its own context
afterAll(() => closeBrowserSuite(suite), 30_000)

const withDashboard = (
  tier: TViewportTier,
  check: (page: Page) => Promise<void>,
  touch = false,
  query = '',
) => {
  return withSuitePage(suite)(
    {
      viewport: {
        width: viewportWidths[tier],
        height: phoneViewport.height,
      },
      hasTouch: touch,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    },
    async (page, { server, base }) => {
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(10_000)
      // The harness supplies fetch; abort anything unexpected before the API proxy.
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__dashboard__/index.html*', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__dashboard__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(`${base}/__dashboard__/index.html${query}`)
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length === 4,
        CARDS,
      )
      await page.evaluate(() => document.fonts.ready)
      await check(page)
    },
  )
}

const afterPaint = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )

// Issue #88, 1.4.1: the extra columns must not appear before md or xl.
for (const { tier, columns, edge } of [
  { tier: 'base', columns: 1, edge: 'at' },
  { tier: 'md', columns: 1, edge: 'immediately below' },
  { tier: 'md', columns: 2, edge: 'at' },
  { tier: 'xl', columns: 2, edge: 'immediately below' },
  { tier: 'xl', columns: 3, edge: 'at' },
] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given the dashboard ${edge} the ${tier} tier`,
      'when its cards and filters render',
      `it should use ${columns} columns without horizontal document overflow`,
    ].join(', '),
    async () => {
      // given
      await withDashboard(tier, async (page) => {
        // when
        if (edge === 'immediately below') {
          await page.setViewportSize({
            width: viewportWidths[tier] - 1,
            height: phoneViewport.height,
          })
        }
        const layout = await page.locator(CARDS).evaluateAll((cards) => ({
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          positions: cards.map((card) => {
            const { x, y, width, bottom } = card.getBoundingClientRect()
            const statsBottom = card
              .querySelector('[data-testid="session-stats"]')
              ?.getBoundingClientRect().bottom
            return {
              x,
              y,
              width,
              statsInside: (statsBottom ?? Number.POSITIVE_INFINITY) <= bottom,
            }
          }),
        }))
        const first = layout.positions[0]

        // then
        expect(layout.document, tier).toBeLessThanOrEqual(layout.viewport + 1)
        expect(layout.positions).toHaveLength(4)
        expect(layout.positions.every(({ statsInside }) => statsInside)).toBe(
          true,
        )
        expect(first).toBeDefined()
        if (first === undefined) return
        expect(
          layout.positions.filter(({ y }) => Math.abs(y - first.y) <= 1),
        ).toHaveLength(columns)
        expect(
          new Set(layout.positions.map(({ x }) => Math.round(x))).size,
        ).toBe(columns)
        if (tier === 'base') {
          expect(first.width).toBeGreaterThan(layout.viewport * 0.85)
        }

        for (const label of [
          'tree',
          'lifecycle',
          'status',
          'branch',
          'state',
        ]) {
          // when
          await page
            .getByRole('button', {
              name: label === 'state' ? 'state · 1' : label,
              exact: true,
            })
            .click()
          const overflow = await page.evaluate(() => ({
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }))

          // then
          expect(
            overflow.document,
            `${tier}: ${label} filter`,
          ).toBeLessThanOrEqual(overflow.viewport + 1)
          await page.keyboard.press('Escape')
        }
      })
    },
    30_000,
  )
}

/*
 * The success card carries six activity dots so its footer cannot fit at base
 * or md. At xl the same footer needs within a few pixels of the cell's 353px
 * content box — 350px in macOS Chromium, 354px in Linux Chromium — so whether
 * it wraps there depends on font rasterisation, and it is left out of the xl
 * cases. The other three cards fit at xl with more than 60px to spare.
 */
for (const { tier, status, inline } of [
  { tier: 'base', status: 'success', inline: false },
  { tier: 'md', status: 'success', inline: false },
  { tier: 'xl', status: 'fail', inline: true },
  { tier: 'xl', status: 'running', inline: true },
  { tier: 'xl', status: 'waiting', inline: true },
] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given issue #88's ${status} card in the ${tier} dashboard grid`,
      'when its status, activity dots and start date render',
      inline
        ? 'it should keep the start date right-aligned beside the status chip when the footer fits'
        : 'it should wrap the start date below the status chip when the footer does not fit',
    ].join(', '),
    async () => {
      // given — issue #88, 1.6.2: measure grid cells, not viewport-wide cards.
      await withDashboard(tier, async (page) => {
        const card = page.locator(`main a[href*="dashboard-${status}"]`)

        // when
        await afterPaint(page)
        const chip = await card.getByText(status, { exact: true }).boundingBox()
        const date = await card.getByText(/\d{1,2}:\d{2}:\d{2}/).boundingBox()
        if (!(chip && date)) {
          throw new Error(`Missing ${status} card status or start date`)
        }
        const contentRight = await card.evaluate((element) => {
          const style = getComputedStyle(element)
          return (
            element.getBoundingClientRect().right -
            Number.parseFloat(style.paddingRight) -
            Number.parseFloat(style.borderRightWidth)
          )
        })

        // then
        if (inline) {
          const columns = await page
            .locator(CARDS)
            .evaluateAll((cards) =>
              cards.map((element) =>
                Math.round(element.getBoundingClientRect().x),
              ),
            )
          expect(new Set(columns).size).toBe(3)
          expect(
            date.y,
            `${status}: start date must share the status row`,
          ).toBeLessThan(chip.y + chip.height)
          expect(date.y + date.height).toBeGreaterThan(chip.y)
          expect(date.x).toBeGreaterThan(chip.x + chip.width)
          expect(
            Math.abs(date.x + date.width - contentRight),
          ).toBeLessThanOrEqual(1)
        } else {
          expect(
            date.y,
            `${tier}: crowded footer must wrap`,
          ).toBeGreaterThanOrEqual(chip.y + chip.height)
          expect(date.x + date.width).toBeLessThanOrEqual(contentRight + 1)
        }
      })
    },
    30_000,
  )
}

test.skipIf(!browserTestsEnabled)(
  [
    'given one watched tree at the base tier',
    'when the dashboard lists its four runs without a tree filter',
    'it should show every recorded branch on its card',
  ].join(', '),
  async () => {
    // given
    await withDashboard(
      'base',
      async (page) => {
        // when
        const cards = page.locator(CARDS)
        const labels = await cards.evaluateAll((elements) =>
          elements.map((card) => ({
            run: card.getAttribute('href')?.split(':').at(-1),
            branches: Array.from(
              card.querySelectorAll('[data-testid="session-branch"]'),
              (branch) => ({
                text: branch.textContent,
                width: branch.getBoundingClientRect().width,
              }),
            ),
          })),
        )

        // then
        expect(
          await page.getByRole('button', { name: 'tree', exact: true }).count(),
        ).toBe(0)
        expect(labels).toHaveLength(4)
        for (const { run, branches } of labels) {
          expect(branches).toHaveLength(1)
          expect(branches[0]?.text).toBe(
            run === 'dashboard-success' || run === 'dashboard-running'
              ? 'main'
              : 'feature/dashboard',
          )
          expect(branches[0]?.width).toBeGreaterThan(0)
        }
      },
      false,
      '?trees=one',
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given two watched trees at the xl tier',
    'when filtering the dashboard to alpha',
    'it should retain main on both remaining cards',
  ].join(', '),
  async () => {
    // given
    await withDashboard('xl', async (page) => {
      // when
      await page.getByRole('button', { name: 'tree', exact: true }).click()
      await page.getByRole('checkbox', { name: 'alpha', exact: true }).check()
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length === 2,
        CARDS,
      )
      const cards = page.locator(CARDS)

      // then
      expect(await cards.count()).toBe(2)
      for (const card of await cards.all()) {
        const branch = card.getByTestId('session-branch')
        expect(await branch.count()).toBe(1)
        expect(await branch.textContent()).toBe('main')
        expect((await branch.boundingBox())?.width).toBeGreaterThan(0)
      }
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given two watched trees at the xl tier',
    'when opening the tree filter',
    'it should match every branch chip colour to its tree option and retain its path',
  ].join(', '),
  async () => {
    // given
    await withDashboard('xl', async (page) => {
      // when
      await page.getByRole('button', { name: 'tree', exact: true }).click()
      const colors = await page.locator(CARDS).evaluateAll((cards) =>
        ['alpha', 'beta'].map((workspace) => {
          const option = Array.from(
            document.querySelectorAll('label span'),
          ).find((element) => element.textContent === workspace)
          if (!option) throw new Error(`Missing tree option: ${workspace}`)
          const matching = cards.flatMap((card) =>
            Array.from(card.querySelectorAll('[data-testid="session-branch"]'))
              .filter(
                (element) =>
                  element.getAttribute('title') === `/fixture/${workspace}`,
              )
              .map((element) => ({
                color: getComputedStyle(element).color,
                title: element.getAttribute('title'),
              })),
          )
          return { workspace, color: getComputedStyle(option).color, matching }
        }),
      )

      // then
      expect(colors[0]?.color).not.toBe(colors[1]?.color)
      for (const { workspace, color, matching } of colors) {
        expect(matching).toHaveLength(2)
        for (const chip of matching) {
          expect(chip.color).toBe(color)
          expect(chip.title).toBe(`/fixture/${workspace}`)
        }
      }
    })
  },
  30_000,
)

// No rendered component varies at lg: the shell and grid use sm, md and xl,
// and the filter's @3xl/dashboard query resolves at md, not lg.
for (const tier of ['base', 'sm', 'md', 'xl', '2xl'] as const) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given dashboard cards with 120-character branches at the ${tier} tier`,
      'when measuring their branch chips',
      'it should keep every chip inside its card without horizontal document overflow',
    ].join(', '),
    async () => {
      // given
      await withDashboard(
        tier,
        async (page) => {
          // when
          const layout = await page.locator(CARDS).evaluateAll((cards) => ({
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            chips: cards.map((card) => {
              const branches = card.querySelectorAll(
                '[data-testid="session-branch"]',
              )
              const branch = branches[0]
              if (!branch) throw new Error('Missing branch chip')
              const bounds = card.getBoundingClientRect()
              const rect = branch.getBoundingClientRect()
              return {
                count: branches.length,
                length: branch.textContent?.length,
                inside:
                  rect.top >= bounds.top - 0.5 &&
                  rect.bottom <= bounds.bottom + 0.5 &&
                  rect.left >= bounds.left - 0.5 &&
                  rect.right <= bounds.right + 0.5,
              }
            }),
          }))

          // then
          expect(layout.chips).toHaveLength(4)
          for (const chip of layout.chips) {
            expect(chip.count).toBe(1)
            expect(chip.length).toBe(120)
            expect(chip.inside).toBe(true)
          }
          expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1)
        },
        false,
        '?branch=long',
      )
    },
    30_000,
  )
}

const styleDifferences = (
  page: Page,
  cases: readonly Readonly<{
    selector: string
    css: string
    properties: readonly string[]
  }>[],
) =>
  page.evaluate((cases) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('Missing colour-normalization canvas')
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      // biome-ignore lint/plugin/no-object-mutation: canvas exposes its colour through a setter, not immutable construction.
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const visibleShadow = (shadow: string) =>
      shadow
        .split(/,(?![^()]*\))/)
        .map((part) => part.trim())
        .filter((part) => part !== 'rgba(0, 0, 0, 0) 0px 0px 0px 0px')
        .join(', ')
    return cases.flatMap(({ selector, css, properties }) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing dashboard element: ${selector}`)
      const reference = element.cloneNode(false)
      if (!(reference instanceof Element)) throw new Error('Missing reference')
      reference.removeAttribute('class')
      reference.removeAttribute('id')
      reference.setAttribute('style', css)
      element.after(reference)
      try {
        const actual = getComputedStyle(element)
        const expected = getComputedStyle(reference)
        return properties.flatMap((property) => {
          const a = actual.getPropertyValue(property)
          const e = expected.getPropertyValue(property)
          const matches = property.endsWith('color')
            ? rgba(a).every(
                (channel, index) =>
                  Math.abs(channel - (rgba(e)[index] ?? Number.NaN)) <= 1,
              )
            : property === 'box-shadow'
              ? visibleShadow(a) === visibleShadow(e)
              : a === e
          return matches ? [] : [{ selector, property, actual: a, expected: e }]
        })
      } finally {
        reference.remove()
      }
    })
  }, cases)

test.skipIf(!browserTestsEnabled)(
  [
    'given a dashboard under a coarse pointer at the base tier',
    'when no card is hovered',
    'it should reveal every accessibly named archive control',
  ].join(', '),
  async () => {
    // given
    await withDashboard(
      'base',
      async (page) => {
        // when
        const controls = await page
          .getByRole('button', { name: 'Archive run', exact: true })
          .evaluateAll((buttons) => ({
            coarse: matchMedia('(pointer: coarse)').matches,
            opacities: buttons.map(
              (button) => getComputedStyle(button).opacity,
            ),
          }))

        // then
        expect(controls).toEqual({
          coarse: true,
          opacities: ['1', '1', '1', '1'],
        })
      },
      true,
    )
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given a dashboard under a fine pointer at the xl tier',
    'when a card is hovered and then reached by keyboard',
    'it should reveal the archive control on hover and focus and retain the themed focus ring',
  ].join(', '),
  async () => {
    // given
    await withDashboard('xl', async (page) => {
      const card = page.locator(CARDS).first()
      const archive = card.getByRole('button', { name: 'Archive run' })
      const waitForArchive = () =>
        page.waitForFunction(() => {
          const button = document.querySelector(
            'main a[href*="dashboard-success"] button[aria-label="Archive run"]',
          )
          return button ? getComputedStyle(button).opacity === '1' : false
        })
      expect(
        await archive.evaluate((button) => getComputedStyle(button).opacity),
      ).toBe('0')

      // when
      await card.hover()
      await waitForArchive()

      // then
      expect(
        await archive.evaluate((button) => getComputedStyle(button).opacity),
      ).toBe('1')

      // when
      await page.mouse.move(0, 0)
      await page.keyboard.press('Tab')
      await card.focus()
      await afterPaint(page)

      // then
      expect(
        await card.evaluate((element) => element.matches(':focus-visible')),
      ).toBe(true)
      expect(
        await styleDifferences(page, [
          {
            selector: CARDS,
            css: 'outline:none;box-shadow:var(--ring)',
            properties: ['outline-style', 'box-shadow'],
          },
        ]),
      ).toEqual([])

      // when
      await page.keyboard.press('Tab')
      await waitForArchive()

      // then
      expect(
        await archive.evaluate((button) => ({
          focused: button.matches(':focus-visible'),
          opacity: getComputedStyle(button).opacity,
        })),
      ).toEqual({ focused: true, opacity: '1' })
    })
  },
  30_000,
)
