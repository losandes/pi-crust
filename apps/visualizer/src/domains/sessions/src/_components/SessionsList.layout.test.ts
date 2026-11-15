import { expect, test } from 'bun:test'
import { chromium, devices, type Page } from 'playwright'
import {
  startHarnessServer,
  type TViewportTier,
  viewportWidths,
} from '@/lib/testing'

const HARNESS_HTML = `<!doctype html>
<html><body><div id="app"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/sessions-list-harness.tsx"></script>
</body></html>`

const probe = await chromium.launch().catch(() => undefined)
const hasChromium = probe !== undefined
await probe?.close()
if (!hasChromium) {
  console.warn(
    'SessionsList.layout.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

const CARDS = 'main a[href*="dashboard-"]'

const withDashboard = async (
  tier: TViewportTier,
  check: (page: Page) => Promise<void>,
  touch = false,
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
        hasTouch: touch,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      })
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(10_000)
      // The harness supplies fetch; abort anything unexpected before the API proxy.
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__dashboard__/index.html', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__dashboard__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(`${base}/__dashboard__/index.html`)
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length === 4,
        CARDS,
      )
      await page.waitForFunction(() =>
        document
          .getElementById('crust-custom-themes')
          ?.textContent?.includes('high-contrast'),
      )
      await page.evaluate(() => document.fonts.ready)
      await check(page)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
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
  { tier: 'sm', columns: 1, edge: 'at' },
  { tier: 'md', columns: 1, edge: 'immediately below' },
  { tier: 'md', columns: 2, edge: 'at' },
  { tier: 'lg', columns: 2, edge: 'at' },
  { tier: 'xl', columns: 2, edge: 'immediately below' },
  { tier: 'xl', columns: 3, edge: 'at' },
  { tier: '2xl', columns: 3, edge: 'at' },
] as const) {
  test.skipIf(!hasChromium)(
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
            height: devices['iPhone SE'].viewport.height,
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

for (const { tier, status, inline } of [
  { tier: 'base', status: 'success', inline: false },
  { tier: 'md', status: 'success', inline: false },
  { tier: 'xl', status: 'success', inline: true },
  { tier: 'xl', status: 'fail', inline: true },
  { tier: 'xl', status: 'running', inline: true },
  { tier: 'xl', status: 'waiting', inline: true },
] as const) {
  test.skipIf(!hasChromium)(
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

const TYPE = ['font-family', 'font-size', 'font-weight', 'line-height']
const PAINT = [
  'color',
  'border-top-color',
  'border-top-width',
  'border-top-style',
]

// Independent declarations from the dashboard stylesheets at b7b90b9.
const legacyStyles = [
  {
    selector: 'main a[href*="dashboard-success"]',
    css: 'color:var(--text);background:var(--surface);border:var(--border-width) solid var(--border-soft)',
    properties: [...TYPE, ...PAINT, 'background-image', 'background-color'],
  },
  {
    selector: 'main a[href*="dashboard-running"]',
    css: 'border:var(--border-width) solid rgb(var(--busy-rgb)/.6);box-shadow:0 0 22px rgb(var(--busy-rgb)/var(--fill-medium))',
    properties: ['border-top-color', 'box-shadow'],
  },
  {
    selector: 'main a[href*="dashboard-fail"]',
    css: 'border:var(--border-width) solid rgb(var(--fail-rgb)/.6)',
    properties: ['border-top-color'],
  },
  {
    selector: 'main a[href*="dashboard-success"] > span:nth-of-type(1)',
    css: 'font-family:var(--mono);font-size:18px;font-weight:700;color:var(--purple)',
    properties: [...TYPE, 'color'],
  },
  {
    selector: 'main a[href*="dashboard-success"] > span:nth-of-type(2)',
    css: 'font-family:var(--mono);font-size:12px;line-height:1.5;color:rgb(var(--blue-rgb));background:rgb(var(--blue-rgb)/.14)',
    properties: [...TYPE, 'color', 'background-color'],
  },
  {
    selector: 'main a[href*="dashboard-success"] > span:nth-of-type(3)',
    css: 'font-family:var(--mono);font-size:16px;color:var(--cyan)',
    properties: [...TYPE, 'color'],
  },
  {
    selector: 'main a[href*="dashboard-success"] [title="planner — success"]',
    css: 'color:var(--ok);font-size:16px',
    properties: [...TYPE, 'color'],
  },
  {
    selector: 'main a[href*="dashboard-success"] [title="builder — fail"]',
    css: 'color:var(--fail)',
    properties: ['color'],
  },
  {
    selector: 'main a[href*="dashboard-success"] [title="reviewer — running"]',
    css: 'color:var(--busy);animation-name:crust-pulse',
    properties: ['color', 'animation-name'],
  },
  {
    selector: 'main a[href*="dashboard-success"] [title="documenter — queued"]',
    css: 'color:var(--faint)',
    properties: ['color'],
  },
  {
    selector: 'main a[href*="dashboard-running"] [title^="tool_call"]',
    css: 'animation-name:crust-pulse;box-shadow:0 0 10px currentColor',
    properties: ['animation-name', 'box-shadow'],
  },
  {
    selector: 'main button[aria-haspopup="true"]',
    css: 'font-family:var(--mono);font-size:13px;color:var(--dim);border:var(--border-width) solid var(--border-soft);background:transparent',
    properties: [...TYPE, ...PAINT, 'background-color'],
  },
]

const styleDifferences = (page: Page, cases = legacyStyles) =>
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

test.skipIf(!hasChromium)(
  [
    'given the dashboard at the xl tier',
    'when dark, light, both auto schemes and a runtime-registered theme are selected',
    'it should preserve the cards and filter typography, surfaces and semantic colours',
  ].join(', '),
  async () => {
    // given
    await withDashboard('xl', async (page) => {
      for (const { theme, scheme } of [
        { theme: 'Dark', scheme: 'dark' },
        { theme: 'Light', scheme: 'light' },
        { theme: 'Auto', scheme: 'light' },
        { theme: 'Auto', scheme: 'dark' },
        { theme: 'High contrast', scheme: 'dark' },
      ] as const) {
        // when
        await page.emulateMedia({ colorScheme: scheme })
        await page.getByRole('button', { name: /^Theme:/ }).click()
        await page.getByRole('option', { name: theme, exact: true }).click()
        await afterPaint(page)

        // then
        expect(await styleDifferences(page), `${theme}: ${scheme}`).toEqual([])
      }
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given a running activity glyph and the latest event dot in real dashboard cards',
    'when their animations are sampled with motion enabled',
    'it should retain the original pulse durations, endpoints and depth',
  ].join(', '),
  async () => {
    // given
    await withDashboard('xl', async (page) => {
      // when
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await afterPaint(page)
      const pulses = await page
        .locator(
          'main a[href*="dashboard-success"] [title="reviewer — running"], main a[href*="dashboard-running"] [title^="tool_call"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            const [animation] = element.getAnimations()
            const duration = animation?.effect?.getComputedTiming().duration
            if (!animation || typeof duration !== 'number') {
              throw new Error('Missing dashboard pulse animation')
            }
            animation.pause()
            const frames = [0, 0.5, 1].map((progress) => {
              // biome-ignore lint/plugin/no-object-mutation: seeking a browser-owned Animation requires its currentTime setter.
              animation.currentTime = duration * progress
              return Number(getComputedStyle(element).opacity)
            })
            return { duration: style.animationDuration, frames }
          }),
        )

      // then
      expect(pulses).toEqual([
        { duration: '1.2s', frames: [1, 0.35, 1] },
        { duration: '1.4s', frames: [1, 0.35, 1] },
      ])
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
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

test.skipIf(!hasChromium)(
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
