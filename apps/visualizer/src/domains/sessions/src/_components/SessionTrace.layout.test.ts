import { expect, test } from 'bun:test'
import { chromium, devices, type Page } from 'playwright'
import {
  startHarnessServer,
  type TViewportTier,
  viewportWidths,
} from '@/lib/testing'

const HARNESS_HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="app"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/session-trace-harness.tsx"></script>
</body></html>`

const probe = await chromium.launch().catch(() => undefined)
const hasChromium = probe !== undefined
await probe?.close()
if (!hasChromium) {
  console.warn(
    'SessionTrace.layout.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

const TRACE = 'main > div'
const STRIP = `${TRACE} > div:first-child`
const WATERFALL = `${TRACE} > div:nth-child(2)`
const NOTICES = `${TRACE} > div:nth-child(3)`
const RUNNING_BLOCK = 'button[title^="build — running"]'

const withTrace = async (
  tier: TViewportTier,
  check: (page: Page) => Promise<void>,
  status = 'waiting',
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
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      })
      page.setDefaultTimeout(5_000)
      page.setDefaultNavigationTimeout(10_000)
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__trace__/index.html*', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__trace__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(
        `${base}/__trace__/index.html?status=${status}#/fixture:trace-layout`,
      )
      await page.locator(RUNNING_BLOCK).waitFor()
      await page.getByRole('heading', { name: 'unexplained changes' }).waitFor()
      if (status === 'waiting') {
        await page
          .getByRole('region', { name: 'what this run is asking' })
          .waitFor()
      }
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

for (const { tier, columns, below } of [
  { tier: 'base', columns: 1, below: false },
  { tier: 'sm', columns: 1, below: false },
  { tier: 'md', columns: 1, below: true },
  { tier: 'md', columns: 2, below: false },
  { tier: 'lg', columns: 2, below: false },
  { tier: 'xl', columns: 2, below: false },
  { tier: '2xl', columns: 2, below: false },
] as const) {
  test.skipIf(!hasChromium)(
    [
      `given the trace ${below ? 'immediately below' : 'at'} the ${tier} tier with its real child panels`,
      'when the waterfall is measured in Chromium',
      `it should use ${columns} columns without horizontal document overflow`,
    ].join(', '),
    async () => {
      // given
      await withTrace(tier, async (page) => {
        // when
        if (below) {
          await page.setViewportSize({
            width: viewportWidths[tier] - 1,
            height: devices['iPhone SE'].viewport.height,
          })
        }
        const layout = await page
          .locator(`${WATERFALL} > div`)
          .evaluateAll((rows) => ({
            document: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            rows: rows.map((row) => {
              const label = row.children[0]?.getBoundingClientRect()
              const track = row.children[1]?.getBoundingClientRect()
              if (!(label && track))
                throw new Error('Missing waterfall label or track')
              return {
                columns:
                  getComputedStyle(row).gridTemplateColumns.split(/\s+/).length,
                label: {
                  x: label.x,
                  y: label.y,
                  width: label.width,
                  bottom: label.bottom,
                },
                track: { x: track.x, y: track.y, width: track.width },
              }
            }),
          }))

        // then
        expect(
          layout.document,
          `${tier}: whole trace page`,
        ).toBeLessThanOrEqual(layout.viewport + 1)
        expect(layout.rows).toHaveLength(6)
        for (const row of layout.rows) {
          expect(row.columns, tier).toBe(columns)
          if (columns === 1) {
            expect(Math.abs(row.track.x - row.label.x)).toBeLessThanOrEqual(1)
            expect(row.track.y).toBeGreaterThanOrEqual(row.label.bottom - 1)
            expect(
              Math.abs(row.track.width - row.label.width),
            ).toBeLessThanOrEqual(1)
          } else {
            expect(row.track.x).toBeGreaterThan(row.label.x)
            expect(Math.abs(row.track.y - row.label.y)).toBeLessThanOrEqual(1)
            expect(row.label.width).toBe(18 * 16)
          }
        }
      })
    },
    30_000,
  )
}

const TYPE = ['font-family', 'font-size', 'font-weight', 'line-height']
const BORDER = ['border-top-color', 'border-top-width', 'border-top-style']

// Independent declarations from the two stylesheets replaced by issue #89.
const legacyStyles = [
  {
    selector: STRIP,
    css: 'display:flex;align-items:center;flex-wrap:wrap;border-bottom:var(--border-width) solid var(--border-soft)',
    properties: [
      'display',
      'align-items',
      'flex-wrap',
      'border-bottom-color',
      'border-bottom-width',
    ],
  },
  {
    selector: `${STRIP} > span:first-child`,
    css: 'font-size:17px;color:var(--text);max-width:52ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
    properties: [...TYPE, 'color', 'max-width', 'text-overflow', 'white-space'],
  },
  {
    selector: WATERFALL,
    css: 'background:var(--surface);border:var(--border-width) solid var(--border-soft)',
    properties: [...BORDER, 'background-color', 'background-image'],
  },
  {
    selector: `${WATERFALL} > div:first-child`,
    css: 'background:var(--panel-2);border-bottom:var(--border-width) solid var(--border)',
    properties: [
      'background-color',
      'border-bottom-color',
      'border-bottom-width',
    ],
  },
  {
    selector: `${WATERFALL} > div:first-child > div:nth-child(2) > span:first-child`,
    css: 'font-size:16px;color:var(--amber)',
    properties: [...TYPE, 'color'],
  },
  {
    selector: `${WATERFALL} > div:first-child > div:nth-child(2) > span:nth-child(2)`,
    css: 'font-family:var(--mono);font-size:16px;color:var(--dim)',
    properties: [...TYPE, 'color'],
  },
  {
    selector: `${WATERFALL} > div:nth-child(2) > div:first-child > span:first-child`,
    css: 'font-size:17px;font-weight:700',
    properties: TYPE,
  },
  {
    selector: `${WATERFALL} > div:nth-child(4) > div:first-child > span:nth-child(2)`,
    css: 'font-family:var(--mono);font-size:16px;color:var(--dim)',
    properties: [...TYPE, 'color'],
  },
  {
    selector: `${WATERFALL} > div:nth-child(4) > div:first-child > span:nth-child(3) > span:first-child > span:first-child`,
    css: 'font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)',
    properties: [...TYPE, 'letter-spacing', 'text-transform', 'color'],
  },
  {
    selector: `${WATERFALL} > div:nth-child(4) > div:first-child > span:nth-child(3) > span:first-child > span:nth-child(2)`,
    css: 'font-family:var(--mono);font-size:14px;color:var(--dim)',
    properties: [...TYPE, 'color'],
  },
  {
    selector: `${WATERFALL} > div:nth-child(4) > div:first-child > span:nth-child(3) > span:nth-child(2)`,
    css: 'background:rgb(var(--bg-rgb)/.75);border:var(--border-width) solid var(--border-soft)',
    properties: [...BORDER, 'background-color'],
  },
  {
    selector: RUNNING_BLOCK,
    css: 'font-size:16px;color:var(--text);display:flex;flex-direction:column;text-align:left',
    properties: [...TYPE, 'color', 'display', 'flex-direction', 'text-align'],
  },
  {
    selector: `${RUNNING_BLOCK} > span:first-child`,
    css: 'display:flex;align-items:baseline',
    properties: ['display', 'align-items'],
  },
  {
    selector: `${RUNNING_BLOCK} > span:first-child > span:nth-child(2)`,
    css: 'font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis',
    properties: [...TYPE, 'text-overflow'],
  },
  {
    selector: `${RUNNING_BLOCK} > span:nth-child(2)`,
    css: 'font-size:16px;color:var(--dim);text-overflow:ellipsis',
    properties: [...TYPE, 'color', 'text-overflow'],
  },
  ...[
    { name: 'plan — success', color: 'green' },
    { name: 'retry — fail', color: 'red' },
    { name: 'build — running', color: 'blue' },
    { name: 'review — queued', color: 'faint' },
  ].map(({ name, color }) => ({
    selector: `button[title^="${name}"] > span:first-child > span:first-child`,
    css: `font-size:16px;color:var(--${color})`,
    properties: [...TYPE, 'color'],
  })),
  {
    selector: 'button[title="review — queued"]',
    css: 'font-size:16px;background:transparent;border:var(--border-width) dashed var(--faint);color:var(--dim)',
    properties: [...TYPE, ...BORDER, 'color', 'background-color'],
  },
  {
    selector: NOTICES,
    css: 'display:flex;flex-direction:column;background:var(--panel-2);border:var(--border-width) solid var(--border-soft);border-left-width:3px',
    properties: [
      ...BORDER,
      'display',
      'flex-direction',
      'background-color',
      'border-left-width',
    ],
  },
  {
    selector: `${NOTICES} > div:first-child`,
    css: 'display:flex;align-items:flex-start;font-size:14px;line-height:1.5',
    properties: [...TYPE, 'display', 'align-items'],
  },
  {
    selector: `${NOTICES} > div:first-child > svg`,
    css: 'color:var(--dim)',
    properties: ['color'],
  },
  {
    selector: `${NOTICES} > div:first-child > span > span`,
    css: 'font-style:italic',
    properties: ['font-style'],
  },
]

const styleDifferences = (page: Page) =>
  page.evaluate((cases) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('Missing colour-normalization canvas')
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      // biome-ignore lint/plugin/no-object-mutation: the browser canvas exposes colour normalization through a setter.
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    return cases.flatMap(({ selector, css, properties }) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing trace element: ${selector}`)
      const reference = element.cloneNode(false)
      if (!(reference instanceof Element)) throw new Error('Missing reference')
      reference.removeAttribute('class')
      reference.setAttribute(
        'style',
        `${element.getAttribute('style') ?? ''};${css}`,
      )
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
            : a === e
          return matches ? [] : [{ selector, property, actual: a, expected: e }]
        })
      } finally {
        reference.remove()
      }
    })
  }, legacyStyles)

test.skipIf(!hasChromium)(
  [
    'given the trace at the xl tier',
    'when dark, light, both auto schemes and a runtime-registered theme are selected',
    'it should retain the shell and notice typography, semantic colours, surfaces and alignment',
  ].join(', '),
  async () => {
    // given
    await withTrace('xl', async (page) => {
      for (const { theme, scheme } of [
        { theme: 'Dark', scheme: 'dark' },
        { theme: 'Light', scheme: 'light' },
        { theme: 'Auto', scheme: 'dark' },
        { theme: 'Auto', scheme: 'light' },
        { theme: 'High contrast', scheme: 'dark' },
      ] as const) {
        // when
        await page.emulateMedia({ colorScheme: scheme })
        await page.getByRole('button', { name: /^Theme:/ }).click()
        await page.getByRole('option', { name: theme, exact: true }).click()
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )

        // then
        expect(await styleDifferences(page), `${theme}: ${scheme}`).toEqual([])
      }
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given the trace running block and its status glyph',
    'when their app-owned animations are sampled with motion enabled',
    'it should preserve both pulse durations, easing and opacity endpoints',
  ].join(', '),
  async () => {
    // given
    await withTrace('xl', async (page) => {
      // when
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const pulses = await page
        .locator(
          `${RUNNING_BLOCK}, ${RUNNING_BLOCK} > span:first-child > span:first-child`,
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element)
            const [animation] = element.getAnimations()
            const duration = animation?.effect?.getComputedTiming().duration
            if (!animation || typeof duration !== 'number')
              throw new Error('Missing trace pulse')
            animation.pause()
            const frames = [0, 0.5, 1].map((progress) => {
              // biome-ignore lint/plugin/no-object-mutation: seeking a browser-owned Animation requires its currentTime setter.
              animation.currentTime = duration * progress
              return Number(getComputedStyle(element).opacity)
            })
            return {
              name: style.animationName,
              duration: style.animationDuration,
              easing: style.animationTimingFunction,
              frames,
            }
          }),
        )

      // then
      expect(pulses).toEqual([
        {
          name: 'crust-pulse',
          duration: '1.6s',
          easing: 'ease-in-out',
          frames: [1, 0.35, 1],
        },
        {
          name: 'crust-pulse',
          duration: '1.2s',
          easing: 'ease-in-out',
          frames: [1, 0.35, 1],
        },
      ])
    })
  },
  30_000,
)
