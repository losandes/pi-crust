import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { chromium, devices, type Page } from 'playwright'
import { build } from 'vite'
import { startHarnessServer, viewportWidths } from '@/lib/testing'

const hasChromium = existsSync(chromium.executablePath())
if (!hasChromium) {
  console.warn(
    'default-layout.layout.test.ts: no Chromium — skipping browser checks. Run `bunx playwright install chromium`.',
  )
}

const registeredTheme = {
  name: 'high-contrast',
  label: 'High contrast',
  builtin: false,
  css: readFileSync(
    new URL(
      '../../../../templates/stamp/config/high-contrast.css',
      import.meta.url,
    ),
    'utf8',
  ),
}
const themes = [
  { name: 'auto', label: 'Auto', builtin: true, css: '' },
  { name: 'light', label: 'Light', builtin: true, css: '' },
  { name: 'dark', label: 'Dark', builtin: true, css: '' },
  registeredTheme,
]

const HARNESS_HTML = `<!doctype html>
<html><body><div id="app"></div>
<script type="module">
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '@fontsource/play/400.css'
import '@fontsource/play/700.css'
import '/src/style.css'
import DefaultLayout from '/src/layouts/default-layout.tsx'
import { applyTheme, storedTheme } from '/src/domains/themes/index.ts'
applyTheme(document.documentElement, storedTheme(window.localStorage), window.matchMedia)
flushSync(() => createRoot(document.getElementById('app')).render(
  h(DefaultLayout, undefined, h('p', undefined, 'Shell-only fixture'))))
</script></body></html>`

const buildCss = async () => {
  const result = await build({
    root: new URL('../../', import.meta.url).pathname,
    logLevel: 'silent',
    // Inline fonts so the write-free build still measures the app's real type.
    build: { write: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER },
  })
  return (Array.isArray(result) ? result : [result])
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
}

const productionCss = hasChromium ? await buildCss() : ''

const withShell = async (check: (page: Page) => Promise<void>) => {
  const { server, base } = await startHarnessServer()
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({
        viewport: {
          width: viewportWidths.xl,
          height: devices['iPhone SE'].viewport.height,
        },
        colorScheme: 'dark',
        reducedMotion: 'no-preference',
      })
      // This harness mounts only the chrome; no observe API or database runs.
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/api/themes*', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ themes }),
        }),
      )
      await page.route('**/__shell__/index.html', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__shell__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(`${base}/__shell__/index.html`)
      await page.locator('header button').waitFor()
      await page.waitForFunction(() =>
        document
          .getElementById('crust-custom-themes')
          ?.textContent?.includes('high-contrast'),
      )
      await page
        .locator('style[data-vite-dev-id], link[rel="stylesheet"]')
        .evaluateAll((elements) => {
          for (const element of elements) element.remove()
        })
      expect(productionCss).not.toBe('')
      await page.addStyleTag({ content: productionCss })
      await page.locator('#crust-custom-themes').evaluate((element) => {
        document.head.appendChild(element)
      })
      await page.evaluate(() => document.fonts.ready)
      await check(page)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

const TYPE = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
]
const PAINT = [
  'color',
  'background-color',
  'border-top-color',
  'border-top-width',
  'border-top-style',
]
type TStyleCase = Readonly<{
  selector: string
  css: string
  exact: readonly string[]
  rounded?: readonly string[]
  pseudo?: string
}>

// Independent oracle: the two stylesheets at 4dafe46c, before issue #87.
// Only scale-rounded dimensions may drift, by at most one default scale step.
const chromeStyles: readonly TStyleCase[] = [
  {
    selector: 'header',
    css: 'display:flex;align-items:center;justify-content:space-between;padding:15px 28px;background:rgb(var(--panel-rgb) / .72);backdrop-filter:blur(14px);position:sticky;top:0;z-index:10',
    exact: [
      ...PAINT,
      'display',
      'align-items',
      'justify-content',
      'position',
      'top',
      'z-index',
    ],
    rounded: ['padding-top', 'padding-right', 'backdrop-filter'],
  },
  {
    selector: 'header',
    pseudo: '::after',
    css: 'content:"";position:absolute;left:0;right:0;bottom:0;height:var(--border-width);background:linear-gradient(90deg,rgb(var(--purple-rgb) / .45),rgb(var(--cyan-rgb) / .35) 40%,rgb(var(--cyan-rgb) / .06))',
    exact: [
      'content',
      'position',
      'left',
      'right',
      'bottom',
      'height',
      'background-image',
    ],
  },
  {
    selector: 'nav',
    css: 'display:flex;align-items:center;gap:10px;font-size:17px;min-width:0',
    exact: [...TYPE, 'display', 'align-items', 'min-width'],
    rounded: ['gap'],
  },
  {
    selector: 'nav img',
    css: 'width:28px;height:28px;flex:none;filter:drop-shadow(0 0 8px rgb(var(--purple-rgb) / .35))',
    exact: ['flex-shrink', 'filter'],
    rounded: ['width', 'height'],
  },
  {
    selector: 'nav > span:nth-child(2)',
    css: 'background:linear-gradient(90deg,var(--purple),var(--cyan));background-clip:text;color:transparent;font-weight:700;letter-spacing:.05em;white-space:nowrap',
    exact: [
      ...TYPE,
      'background-image',
      'background-clip',
      'color',
      'white-space',
    ],
  },
  {
    selector: 'nav > span:nth-child(3)',
    css: 'color:var(--faint)',
    exact: ['color'],
  },
  { selector: 'nav a', css: 'color:var(--dim)', exact: [...TYPE, 'color'] },
  {
    selector: 'nav > span:last-child',
    css: 'color:var(--text)',
    exact: [...TYPE, 'color'],
  },
  {
    selector: 'header > div',
    css: 'display:flex;align-items:center;gap:16px',
    exact: ['display', 'align-items', 'gap'],
  },
  {
    selector: 'header > div > span',
    css: 'display:inline-flex;align-items:center;gap:8px;color:var(--dim);font-size:16px;white-space:nowrap',
    exact: [...TYPE, 'color', 'display', 'align-items', 'gap', 'white-space'],
  },
  {
    selector: 'header > div > span > span',
    css: 'width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 10px rgb(var(--ok-rgb) / .7);animation:crust-pulse 1.6s ease-in-out infinite',
    exact: [
      'background-color',
      'box-shadow',
      'animation-name',
      'animation-duration',
      'animation-timing-function',
      'animation-iteration-count',
    ],
    rounded: ['width', 'height'],
  },
  {
    selector: 'header button',
    css: 'display:inline-flex;align-items:center;justify-content:center;width:30px;height:26px;padding:0;border:var(--border-width) solid var(--border-soft);border-radius:7px;background:rgb(var(--panel-2-rgb) / .6);color:var(--faint);cursor:pointer',
    exact: [
      ...TYPE,
      ...PAINT,
      'display',
      'align-items',
      'justify-content',
      'padding',
      'cursor',
    ],
    rounded: ['width', 'height', 'border-top-left-radius'],
  },
]
const listStyles: readonly TStyleCase[] = [
  {
    selector: '[role="listbox"]',
    css: 'position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:180px;max-height:320px;overflow-y:auto;margin:0;padding:4px;list-style:none;border:var(--border-width) solid var(--border-soft);border-radius:9px;background:var(--panel-2);box-shadow:var(--shadow-panel)',
    exact: [
      ...TYPE,
      ...PAINT,
      'position',
      'right',
      'z-index',
      'max-height',
      'overflow-y',
      'padding',
      'box-shadow',
    ],
    rounded: ['min-width', 'border-top-left-radius'],
  },
  {
    selector: '[role="option"][aria-selected="false"]',
    css: 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;color:var(--faint);cursor:pointer',
    exact: [
      ...TYPE,
      ...PAINT,
      'display',
      'align-items',
      'gap',
      'padding',
      'cursor',
    ],
    rounded: ['border-top-left-radius'],
  },
  {
    selector: '[role="option"][aria-selected="true"]',
    css: 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;color:var(--accent);background:rgb(var(--accent-rgb) / var(--fill-medium));cursor:pointer',
    exact: [
      ...TYPE,
      ...PAINT,
      'display',
      'align-items',
      'gap',
      'padding',
      'cursor',
    ],
    rounded: ['border-top-left-radius'],
  },
]

const expectLegacyStyles = async (
  page: Page,
  cases: readonly TStyleCase[],
  theme: string,
) => {
  const differences = await page.evaluate((cases) => {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) throw new Error('Missing colour-normalization canvas')
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      // biome-ignore lint/plugin/no-object-mutation: canvas exposes its colour through a setter, not immutable construction.
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const visibleShadow = (value: string) =>
      value
        .split(/,(?![^()]*\))/)
        .map((shadow) => shadow.trim())
        .filter(
          (shadow) =>
            shadow !== 'none' && shadow !== 'rgba(0, 0, 0, 0) 0px 0px 0px 0px',
        )
        .join(', ') || 'none'
    const number = (value: string) =>
      Number.parseFloat(value.match(/-?[\d.]+/)?.[0] ?? '')
    return cases.flatMap(({ selector, css, exact, rounded = [], pseudo }) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing chrome element: ${selector}`)
      const actual = getComputedStyle(element, pseudo)
      const values = Object.fromEntries(
        [...exact, ...rounded].map((property) => [
          property,
          actual.getPropertyValue(property),
        ]),
      )
      const reference = element.cloneNode(false)
      if (!(reference instanceof Element))
        throw new Error('Missing reference element')
      reference.removeAttribute('class')
      reference.removeAttribute('id')
      reference.setAttribute('style', css)
      reference.append(document.createTextNode(element.textContent ?? ''))
      element.after(reference)
      try {
        const expected = getComputedStyle(reference)
        return [...exact, ...rounded].flatMap((property) => {
          const a = values[property] ?? ''
          const e = expected.getPropertyValue(property)
          const matches = property.endsWith('color')
            ? rgba(a).every(
                (channel, index) =>
                  Math.abs(channel - (rgba(e)[index] ?? Number.NaN)) <= 1,
              )
            : rounded.includes(property)
              ? Math.abs(number(a) - number(e)) <= 4
              : property === 'box-shadow'
                ? visibleShadow(a) === visibleShadow(e)
                : a === e
          return matches
            ? []
            : [{ selector, pseudo, property, actual: a, expected: e }]
        })
      } finally {
        reference.remove()
      }
    })
  }, cases)
  expect(differences, theme).toEqual([])
}

for (const route of [
  { hash: '#/', current: 'sessions' },
  { hash: '#/4dafe46c', current: '4dafe46c' },
  { hash: '#/worktree:4dafe46c', current: 'worktree · 4dafe46c' },
  {
    hash: '#/worktree:4dafe46c/4dafe46c_03_build',
    current: '4dafe46c_03_build',
  },
]) {
  test.skipIf(!hasChromium)(
    [
      `given the shell at ${route.hash}`,
      'when reading its breadcrumb in the running page',
      'it should expose only the deepest segment as the current page and truncate it',
    ].join(', '),
    async () => {
      // given
      await withShell(async (page) => {
        // when
        await page.goto(`${page.url().split('#')[0]}${route.hash}`)
        await page.waitForFunction(
          (text) =>
            document.querySelector('nav > :last-child')?.textContent === text,
          route.current,
        )
        const current = page.locator('nav [aria-current]')
        const deepest = page.locator('nav > :last-child')
        // then
        expect(await current.count()).toBe(1)
        expect(await current.getAttribute('aria-current')).toBe('page')
        expect(await current.textContent()).toBe(route.current)
        expect(
          await deepest.evaluate(
            (element) => getComputedStyle(element).textOverflow,
          ),
        ).toBe('ellipsis')
        expect(
          await page
            .locator('nav')
            .evaluate((element) => getComputedStyle(element).minWidth),
        ).toBe('0px')
      })
    },
    30_000,
  )
}

// Neither hash routing nor workspace slugification imposes a length limit.
const longRun = '0123456789abcdef'.repeat(16)
const longWorkspace = 'long-repository-worktree-'.repeat(16)
const longActivity = `${longRun}_99_${'long-activity-name-'.repeat(16)}`
for (const [tier, width] of Object.entries(viewportWidths)) {
  test.skipIf(!hasChromium)(
    [
      `given the shell with long workspace, run and activity identifiers at the ${tier} tier`,
      'when the run and activity breadcrumbs render and the picker opens',
      'it should truncate the deepest segment without horizontal document overflow',
    ].join(', '),
    async () => {
      // given
      await withShell(async (page) => {
        await page.setViewportSize({
          width,
          height: devices['iPhone SE'].viewport.height,
        })
        for (const activity of ['', `/${longActivity}`]) {
          // when
          await page.goto(
            `${page.url().split('#')[0]}#/${longWorkspace}:${longRun}${activity}`,
          )
          await page.waitForFunction(
            (text) =>
              document.querySelector('nav > :last-child')?.textContent === text,
            activity === '' ? `${longWorkspace} · ${longRun}` : longActivity,
          )
          const readOverflow = () =>
            page.evaluate(() => ({
              document: document.documentElement.scrollWidth,
              viewport: window.innerWidth,
            }))
          const closed = await readOverflow()
          const deepest = await page
            .locator('nav > :last-child')
            .evaluate((element) => ({
              width: element.clientWidth,
              content: element.scrollWidth,
              ellipsis: getComputedStyle(element).textOverflow,
            }))
          await page.locator('header button').click()
          const open = await readOverflow()
          await page.keyboard.press('Escape')
          // then
          expect(
            closed.document,
            JSON.stringify({ tier, hasActivity: activity !== '', closed }),
          ).toBeLessThanOrEqual(closed.viewport + 1)
          expect(
            open.document,
            JSON.stringify({ tier, hasActivity: activity !== '', open }),
          ).toBeLessThanOrEqual(open.viewport + 1)
          expect(deepest.width).toBeGreaterThan(0)
          expect(deepest.content).toBeGreaterThan(deepest.width)
          expect(deepest.ellipsis).toBe('ellipsis')
        }
      })
    },
    30_000,
  )
}

test.skipIf(!hasChromium)(
  [
    'given the shell and its theme picker at the xl tier',
    'when dark, light, both auto schemes and a runtime-registered theme are chosen through the picker',
    'it should preserve legacy chrome, colours, typography, focus styling and the live animation',
  ].join(', '),
  async () => {
    // given
    await withShell(async (page) => {
      await page.goto(
        `${page.url().split('#')[0]}#/worktree:4dafe46c/4dafe46c_03_build`,
      )
      await page.waitForFunction(
        () =>
          document.querySelector('nav > :last-child')?.textContent ===
          '4dafe46c_03_build',
      )
      for (const { theme, label, scheme, icon } of [
        { theme: 'dark', label: 'Dark', scheme: 'dark', icon: 'moon' },
        { theme: 'light', label: 'Light', scheme: 'light', icon: 'sun' },
        { theme: 'auto', label: 'Auto', scheme: 'light', icon: 'monitor' },
        { theme: 'auto', label: 'Auto', scheme: 'dark', icon: 'monitor' },
        {
          theme: 'high-contrast',
          label: 'High contrast',
          scheme: 'dark',
          icon: 'contrast',
        },
      ] as const) {
        // when
        await page.emulateMedia({ colorScheme: scheme })
        await page.locator('header button').click()
        await page.getByRole('option', { name: label, exact: true }).click()
        await page.mouse.move(0, 0)
        // then
        expect(
          await page.locator('html').getAttribute('data-theme-choice'),
        ).toBe(theme)
        expect(await page.locator('html').getAttribute('data-theme')).toBe(
          theme === 'auto' ? scheme : theme,
        )
        expect(
          await page.locator('header button svg').getAttribute('class'),
        ).toContain(`lucide-${icon}`)
        expect(await page.locator('header button').getAttribute('title')).toBe(
          `Theme: ${label}`,
        )
        expect(await page.getByRole('listbox').count()).toBe(0)
        await expectLegacyStyles(page, chromeStyles, theme)

        // when
        await page.locator('nav a').first().hover()
        // then
        await expectLegacyStyles(
          page,
          [{ selector: 'nav a', css: 'color:var(--text)', exact: ['color'] }],
          theme,
        )

        // when
        await page.mouse.move(0, 0)
        await page.keyboard.press('Tab')
        await page.locator('header button').focus()
        // then
        await expectLegacyStyles(
          page,
          [
            {
              selector: 'header button',
              css: 'outline:none;box-shadow:var(--ring)',
              exact: ['outline-style', 'box-shadow'],
            },
          ],
          theme,
        )

        // when
        await page.keyboard.press('Enter')
        // then
        await expectLegacyStyles(page, listStyles, theme)
        // top:calc(100% + 6px) and top-full plus margin must align identically.
        const listPosition = await page
          .getByRole('listbox')
          .evaluate((element) => {
            const list = element.getBoundingClientRect()
            const wrapper = element.parentElement?.getBoundingClientRect()
            return {
              gap: list.top - (wrapper?.bottom ?? Number.NaN),
              right: list.right - (wrapper?.right ?? Number.NaN),
            }
          })
        expect(listPosition, theme).toEqual({ gap: 6, right: 0 })
        expect(
          await page.getByRole('option', { selected: true }).textContent(),
        ).toBe(label)
        // when
        await page.keyboard.press('Escape')
        await page
          .locator('header button')
          .evaluate((element) => (element as HTMLButtonElement).blur())
      }
    })
  },
  30_000,
)
