import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { chromium, devices, type Page } from 'playwright'
import { build } from 'vite'
import { startHarnessServer, viewportWidths } from '@/lib/testing'

const hasChromium = existsSync(chromium.executablePath())
if (!hasChromium) {
  console.warn(
    'shared-components.layout.test.ts: no Chromium — skipping browser checks. Run `bunx playwright install chromium`.',
  )
}

const registeredTheme = {
  name: 'high-contrast',
  label: 'High contrast',
  builtin: false,
  css: readFileSync(
    new URL(
      '../../../../../../templates/stamp/config/high-contrast.css',
      import.meta.url,
    ),
    'utf8',
  ),
}

const statusCases = [
  { status: 'success', role: 'ok', fill: 0.09, glow: 0.12 },
  { status: 'fail', role: 'fail', fill: 0.09, glow: 0.12 },
  { status: 'running', role: 'busy', fill: 0.09, glow: 0.18 },
  { status: 'waiting', role: 'waiting', fill: 0.12, glow: 0.22 },
  { status: 'queued', role: 'dim', fill: 0, glow: 0 },
  { status: 'superseded', role: 'dim', fill: 0, glow: 0 },
  { status: 'archived', role: 'dim', fill: 0, glow: 0 },
] as const

const HARNESS_HTML = `<!doctype html>
<html><body>
<select id="theme-choice">
  <option>dark</option><option>light</option><option>auto</option>
  <option>high-contrast</option>
</select>
<div id="fixture" style="padding:1rem"></div>
<script type="module">
import { createElement as h, Fragment, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Activity } from 'lucide-react'
import '/src/style.css'
import { applyCustomThemes, applyTheme } from '/src/domains/themes/index.ts'
import { readToken } from '/src/lib/api-client/index.ts'
import { StatChip, StatusChip, DetailSection, TokenNotice, ConfirmDialog } from '/src/lib/_components/index.ts'
applyCustomThemes(document, [${JSON.stringify(registeredTheme)}])
applyTheme(document.documentElement, 'dark', window.matchMedia)
document.getElementById('theme-choice').addEventListener('change', (event) => {
  applyTheme(document.documentElement, event.target.value, window.matchMedia)
})
const wrap = (id, child) => h('div', { id, key: id }, child)
const notice = (onSaved) => h(TokenNotice, {
  problem: 'The server refused this write. Paste its token to try again.', onSaved,
})
function Fixture() {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [result, setResult] = useState('pending')
  return h(Fragment, undefined,
    ${JSON.stringify(statusCases.map(({ status }) => status))}.map((status) =>
      wrap('status-' + status, h(StatusChip, { status }))),
    wrap('stat-full', h(StatChip, { kind: 'cost', value: 1.5 })),
    wrap('stat-compact', h(StatChip, { kind: 'cost', value: 1.5, compact: true })),
    wrap('detail', h(DetailSection, {
      title: 'Run context', icon: Activity, count: 0, open: expanded,
      onToggle: () => setExpanded((value) => !value),
    }, h('p', undefined, 'Caller-provided details'))),
    wrap('notice', notice(() => setResult('saved ' + readToken()))),
    wrap('quiet-notice', h(TokenNotice, { problem: '', onSaved: () => {} })),
    h('div', { id: 'narrow-panel', style: { width: 'min(100%, 16rem)' } },
      wrap('narrow-notice', notice(() => {})),
      wrap('narrow-detail', h(DetailSection, {
        title: 'UninterruptedContextIdentifier'.repeat(3), count: 0,
        open: true, onToggle: () => {},
      }, h('p', undefined, 'All caller content remains visible.')))),
    h('button', { id: 'open-dialog', onClick: () => {
      setResult('pending'); setOpen(true)
    } }, 'open confirmation'),
    h('output', { id: 'result' }, result),
    h(ConfirmDialog, {
      open, title: 'Abort this run?',
      body: 'Whatever the current activity has done goes with it. ' +
        'This caller-provided explanation must remain visible when the panel narrows.',
      confirmLabel: 'abort the run', cancelLabel: 'keep the run',
      onConfirm: () => { setResult('confirmed'); setOpen(false) },
      onCancel: () => { setResult('cancelled'); setOpen(false) },
    }))
}
flushSync(() => createRoot(document.getElementById('fixture')).render(h(Fixture)))
document.documentElement.setAttribute('data-ready', 'true')
</script>
</body></html>`

const buildCss = async () => {
  const result = await build({
    root: new URL('../../../../', import.meta.url).pathname,
    logLevel: 'silent',
    build: { write: false },
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

// Build once without writing output. Development CSS must not hide a utility
// omitted by the production scanner (issue #86, requirements 1.2.2–1.2.3).
const productionCss = hasChromium ? await buildCss() : ''

const withComponents = async (check: (page: Page) => Promise<void>) => {
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
      // Only frontend modules run; no request can reach the observe API or DB.
      await page.route('**/api/**', (route) => route.abort())
      await page.route('**/__shared__/index.html', async (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: await server.transformIndexHtml(
            '/__shared__/index.html',
            HARNESS_HTML,
          ),
        }),
      )
      await page.goto(`${base}/__shared__/index.html`)
      await page.waitForSelector('[data-ready="true"]')
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
      await check(page)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

type TThemeCase = Readonly<{
  theme: string
  scheme: 'dark' | 'light'
}>

const switchThemes = async (
  page: Page,
  check: (themeCase: TThemeCase) => Promise<void>,
) => {
  for (const themeCase of [
    { theme: 'dark', scheme: 'dark' },
    { theme: 'light', scheme: 'light' },
    { theme: 'auto', scheme: 'light' },
    { theme: 'auto', scheme: 'dark' },
    { theme: 'high-contrast', scheme: 'dark' },
  ] as const) {
    const { theme, scheme } = themeCase
    await page.emulateMedia({ colorScheme: scheme })
    await page.selectOption('#theme-choice', theme)
    expect(
      await page.locator('html').getAttribute('data-theme'),
      JSON.stringify(themeCase),
    ).toBe(theme === 'auto' ? scheme : theme)
    await check(themeCase)
  }
}

const TYPE = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
] as const
const PAINT = [
  'color',
  'background-color',
  'border-top-color',
  'border-top-style',
  'border-top-width',
] as const

// The independent oracle is the pre-migration CSS at b0ac1af, not the
// utilities being tested. Rounded scale values may move an edge by up to 2px;
// typography, semantic colours, border weights and visibility may not drift.
const expectStyle = async (
  page: Page,
  themeCase: TThemeCase,
  selector: string,
  legacyCss: string,
  exact: readonly string[],
  rounded: readonly string[] = [],
) => {
  const differences = await page.locator(selector).evaluate(
    (element, { themeCase, selector, legacyCss, exact, rounded }) => {
      const reference = element.cloneNode(false)
      if (!(reference instanceof Element)) {
        throw new Error(`Missing reference element for ${selector}`)
      }
      reference.removeAttribute('class')
      reference.removeAttribute('id')
      reference.setAttribute('style', legacyCss)
      reference.append(document.createTextNode(element.textContent ?? ''))
      element.after(reference)
      try {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Missing colour-normalization canvas')
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1)
          // biome-ignore lint/plugin/no-object-mutation: canvas accepts a CSS colour only through its fillStyle setter.
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          return Array.from(context.getImageData(0, 0, 1, 1).data)
        }
        // Zero-length, fully transparent framework shadow slots paint nothing.
        const visibleShadow = (value: string) =>
          value
            .split(/,(?![^()]*\))/)
            .map((shadow) => shadow.trim())
            .filter(
              (shadow) =>
                shadow !== 'none' &&
                shadow !== 'rgba(0, 0, 0, 0) 0px 0px 0px 0px',
            )
            .join(', ') || 'none'
        const actual = getComputedStyle(element)
        const expected = getComputedStyle(reference)
        return [...exact, ...rounded].flatMap((property) => {
          const a = actual.getPropertyValue(property)
          const e = expected.getPropertyValue(property)
          const matches = property.endsWith('color')
            ? rgba(a).every(
                (channel, index) =>
                  Math.abs(channel - (rgba(e)[index] ?? Number.NaN)) <= 1,
              )
            : rounded.includes(property)
              ? Math.abs(Number.parseFloat(a) - Number.parseFloat(e)) <= 2
              : property === 'box-shadow'
                ? visibleShadow(a) === visibleShadow(e)
                : a === e
          return matches
            ? []
            : [{ ...themeCase, selector, property, actual: a, expected: e }]
        })
      } finally {
        reference.remove()
      }
    },
    { themeCase, selector, legacyCss, exact, rounded },
  )
  expect(differences).toEqual([])
}

for (const { status, role, fill, glow } of statusCases) {
  const statusLabel =
    status === 'archived' ? 'the unknown-status fallback (archived)' : status
  test.skipIf(!hasChromium)(
    [
      `given issue #86 §1.4.2 StatusChip for ${statusLabel} at the xl tier`,
      'when dark, light, both auto schemes and a registered theme replace one another',
      'it should retain its status tone, edge, fill, typography and animation',
    ].join(', '),
    async () => {
      // given
      const tone = fill
        ? `border-color:rgb(var(--${role}-rgb) / var(--edge-alpha));
           background:rgb(var(--${role}-rgb) / ${fill});
           box-shadow:0 0 ${status === 'waiting' ? 14 : 12}px rgb(var(--${role}-rgb) / ${glow});`
        : ''
      const legacy = `display:inline-flex;align-items:center;gap:7px;
        padding:3px 13px 3px 10px;border-radius:999px;
        border:var(--border-width) solid var(--border);font-size:16px;
        color:var(--${role});white-space:nowrap;${tone}
        ${status === 'queued' ? 'border-style:dashed;' : ''}
        ${status === 'superseded' ? 'text-decoration:line-through;' : ''}`
      await withComponents(async (page) => {
        // when
        await switchThemes(page, async (themeCase) => {
          // then
          await expectStyle(
            page,
            themeCase,
            `#status-${status} > span`,
            legacy,
            [
              ...TYPE,
              ...PAINT,
              'box-shadow',
              'display',
              'align-items',
              'white-space',
              'text-decoration-line',
            ],
            [
              'gap',
              'padding-top',
              'padding-right',
              'padding-bottom',
              'padding-left',
            ],
          )
          expect(
            await page.locator(`#status-${status}`).textContent(),
            JSON.stringify(themeCase),
          ).toBe(status)
          const animation = await page
            .locator(`#status-${status} svg`)
            .evaluate((icon) => {
              const style = getComputedStyle(icon)
              return {
                shrink: style.flexShrink,
                name: style.animationName,
                duration: style.animationDuration,
                timing: style.animationTimingFunction,
                iterations: style.animationIterationCount,
              }
            })
          expect(animation, JSON.stringify(themeCase)).toEqual(
            status === 'running'
              ? {
                  shrink: '0',
                  name: 'crust-spin',
                  duration: '1.1s',
                  timing: 'linear',
                  iterations: 'infinite',
                }
              : {
                  shrink: '0',
                  name: 'none',
                  duration: '0s',
                  timing: 'ease',
                  iterations: '1',
                },
          )
        })
      })
    },
    30_000,
  )
}

for (const compact of [false, true]) {
  test.skipIf(!hasChromium)(
    [
      `given issue #86 §1.4.2 ${compact ? 'compact' : 'full'} StatChip at the xl tier`,
      'when every theme is applied without remounting',
      'it should preserve pill chrome, icon tone and tabular monospaced values',
    ].join(', '),
    async () => {
      // given
      const selector = compact ? '#stat-compact > span' : '#stat-full > span'
      const legacy = `display:inline-flex;align-items:center;gap:7px;
        padding:3px 12px;border:var(--border-width) solid var(--border-soft);
        border-radius:999px;background:rgb(var(--panel-2-rgb) / .6);
        font-size:16px;white-space:nowrap;
        ${compact ? 'padding:0;border:none;background:transparent;' : ''}`
      await withComponents(async (page) => {
        // when
        await switchThemes(page, async (themeCase) => {
          // then
          await expectStyle(
            page,
            themeCase,
            selector,
            legacy,
            [...TYPE, ...PAINT, 'display', 'align-items', 'white-space'],
            ['gap', 'padding-top', 'padding-right'],
          )
          await expectStyle(
            page,
            themeCase,
            `${selector} > svg`,
            'color:var(--faint);flex:none',
            ['color', 'flex-shrink'],
          )
          await expectStyle(
            page,
            themeCase,
            `${selector} > span`,
            `color:var(--${compact ? 'dim' : 'text'});font-family:var(--mono);font-variant-numeric:tabular-nums`,
            [...TYPE, 'color', 'font-variant-numeric'],
          )
          expect(
            await page.locator(`${selector} > span`).textContent(),
            JSON.stringify(themeCase),
          ).toBe('$1.50')
          expect(
            await page.locator(`${selector} > svg`).getAttribute('width'),
            JSON.stringify(themeCase),
          ).toBe(compact ? '17' : '19')
        })
      })
    },
    30_000,
  )
}

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1–1.4.2 an open DetailSection with an icon and a zero count',
    'when themes change and its header is hovered and keyboard-focused',
    'it should retain its hierarchy and interactive styling',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const header = page.locator('#detail button')
      const legacy = `display:flex;align-items:center;gap:9px;width:100%;
        padding:6px 8px;background:none;border:none;
        border-bottom:var(--border-width) solid var(--border-soft);
        border-radius:6px 6px 0 0;color:var(--dim);font-size:16px;
        font-weight:700;letter-spacing:.05em;text-transform:lowercase;
        cursor:pointer;text-align:left;`
      // when
      await switchThemes(page, async (themeCase) => {
        await page.mouse.move(0, 0)
        await header.evaluate((element) =>
          (element as HTMLButtonElement).blur(),
        )
        // then
        await expectStyle(
          page,
          themeCase,
          '#detail button',
          legacy,
          [
            ...TYPE,
            'color',
            'background-color',
            'border-bottom-color',
            'border-bottom-width',
            'border-bottom-style',
            'display',
            'align-items',
            'text-transform',
            'text-align',
          ],
          ['gap', 'padding-top', 'padding-left'],
        )
        await expectStyle(
          page,
          themeCase,
          '#detail button svg',
          'color:var(--faint);flex:none',
          ['color', 'flex-shrink'],
        )
        await expectStyle(
          page,
          themeCase,
          '#detail button > span:last-child',
          'color:var(--dim);font-weight:500',
          ['color', 'font-weight'],
        )
        expect(await header.textContent(), JSON.stringify(themeCase)).toBe(
          '▾Run context(0)',
        )

        // when
        await header.hover()

        // then
        await expectStyle(
          page,
          themeCase,
          '#detail button',
          `${legacy}background:var(--panel-2);color:var(--text)`,
          ['color', 'background-color'],
        )

        // when
        await page.mouse.move(0, 0)
        await page.keyboard.press('Tab')
        await header.focus()
        const focusVisible = await header.evaluate((element) =>
          element.matches(':focus-visible'),
        )

        // then
        expect(focusVisible, JSON.stringify(themeCase)).toBe(true)
        await expectStyle(
          page,
          themeCase,
          '#detail button',
          `${legacy}outline:none;box-shadow:var(--ring)`,
          ['box-shadow', 'outline-style'],
        )
      })
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1 an open DetailSection with caller-provided body content',
    'when its header is activated with Enter and then Space',
    'it should collapse and reopen the body through keyboard interaction',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const header = page.locator('#detail button')
      const detail = page.locator('#detail')

      // when
      await header.press('Enter')
      const collapsed = await detail.textContent()
      await header.press('Space')
      const reopened = await detail.textContent()

      // then
      expect(collapsed).not.toContain('Caller-provided details')
      expect(reopened).toContain('Caller-provided details')
    })
  },
  30_000,
)

const noticeStyles = [
  {
    target: 'section',
    css: 'margin:0 0 .9rem;padding:.75rem .9rem;border:var(--rule-width,1px) solid rgb(var(--amber-rgb) / .45);border-left:3px solid rgb(var(--amber-rgb));border-radius:var(--radius-md,6px);background:rgb(var(--amber-rgb) / .08)',
    exact: [...PAINT, 'border-left-color'],
    rounded: [
      'padding-top',
      'padding-right',
      'border-left-width',
      'margin-bottom',
    ],
  },
  {
    target: 'section > p:first-child',
    css: 'margin:0 0 .6rem;color:rgb(var(--text));font-size:.85rem',
    exact: [...TYPE, 'color'],
    rounded: ['margin-bottom'],
  },
  {
    target: 'label',
    css: 'color:rgb(var(--faint));font-size:.75rem;letter-spacing:.04em;text-transform:lowercase',
    exact: [...TYPE, 'color', 'text-transform'],
  },
  {
    target: 'input',
    css: 'flex:1 1 14rem;min-width:10rem;padding:.35rem .5rem;border:var(--rule-width,1px) solid rgb(var(--border));border-radius:var(--radius-sm,3px);background:rgb(var(--panel-3) / .9);color:rgb(var(--text));font-family:var(--mono);font-size:.8rem',
    exact: [...TYPE, ...PAINT],
    rounded: ['padding-top', 'padding-right', 'border-top-left-radius'],
  },
  {
    target: 'button',
    css: 'padding:.35rem .7rem;border:var(--rule-width,1px) solid rgb(var(--border));border-radius:var(--radius-sm,3px);background:rgb(var(--panel-2));color:rgb(var(--text));font-size:.8rem;cursor:pointer',
    exact: [...TYPE, ...PAINT],
    rounded: ['padding-top', 'padding-right', 'border-top-left-radius'],
  },
  {
    target: 'section > p:last-child',
    css: 'margin:.55rem 0 0;color:rgb(var(--faint));font-size:.75rem;line-height:1.5',
    exact: [...TYPE, 'color'],
    rounded: ['margin-top'],
  },
  {
    target: 'code',
    css: 'font-family:var(--mono);font-size:.72rem',
    exact: TYPE,
  },
] as const

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.2 TokenNotice at the xl tier',
    'when built-in and runtime-registered themes change',
    'it should preserve the refusal edge, text, input and explanatory hint',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      // when
      await switchThemes(page, async (themeCase) => {
        // then
        for (const style of noticeStyles) {
          await expectStyle(
            page,
            themeCase,
            `#notice ${style.target}`,
            style.css,
            style.exact,
            'rounded' in style ? style.rounded : [],
          )
        }
        expect(
          await page.locator('#notice section').getAttribute('aria-live'),
          JSON.stringify(themeCase),
        ).toBe('polite')
      })
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1 a TokenNotice with an empty problem',
    'when it renders in the browser',
    'it should render nothing',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      // when
      const rendered = await page.locator('#quiet-notice').innerHTML()

      // then
      expect(rendered).toBe('')
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1 a refused write and a second independent token notice',
    'when the first label is clicked, a token is entered and Enter submits it',
    'it should focus the associated password field and persist the token across reloads',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const field = page.locator('#notice input')

      // when
      await page.locator('#notice label').click()
      const associatedFieldIsFocused = await field.evaluate(
        (element) => document.activeElement === element,
      )
      await field.pressSequentially('browser-owned-token')
      await field.press('Enter')
      const result = await page.locator('#result').textContent()
      await page.reload()
      await page.waitForSelector('[data-ready="true"]')
      // then
      expect(associatedFieldIsFocused).toBe(true)
      expect(result).toBe('saved browser-owned-token')
      expect(await field.inputValue()).toBe('browser-owned-token')
      expect(await field.getAttribute('type')).toBe('password')
      expect(await field.getAttribute('autocomplete')).toBe('off')
      expect(await field.getAttribute('id')).not.toBe(
        await page.locator('#narrow-notice input').getAttribute('id'),
      )
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.2 an open ConfirmDialog at the xl tier',
    'when themes change and each action is hovered',
    'it should preserve the panel, action ordering, hover fills and neutral translucent backdrop',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      await page.locator('#open-dialog').click()
      const buttons = page.locator('dialog button')
      // Legacy .actions button (0,1,1) overrode .confirm (0,1,0);
      // only .confirm:hover (0,2,0) changed the confirm button's fill.
      const buttonCss =
        'padding:.35rem .85rem;border:var(--border-width) solid rgb(var(--border-rgb));border-radius:var(--radius-sm,4px);background:rgb(var(--panel-rgb));color:rgb(var(--text-rgb));font:inherit;font-size:.86rem;cursor:pointer'
      // when
      await switchThemes(page, async (themeCase) => {
        await page.mouse.move(0, 0)
        // then
        await expectStyle(
          page,
          themeCase,
          'dialog',
          'max-width:28rem;padding:1.1rem 1.25rem;border:var(--border-width) solid rgb(var(--fail-rgb) / var(--edge-alpha));border-radius:var(--radius-md,6px);background:rgb(var(--panel-2-rgb));color:rgb(var(--text-rgb))',
          [...TYPE, ...PAINT, 'max-width', 'border-top-left-radius'],
          ['padding-top', 'padding-right'],
        )
        await expectStyle(
          page,
          themeCase,
          'dialog h2',
          'margin:0 0 .45rem;color:var(--fail);font-size:1rem;font-weight:650',
          [...TYPE, 'color'],
          ['margin-bottom'],
        )
        await expectStyle(
          page,
          themeCase,
          'dialog p',
          'margin:0 0 1rem;color:rgb(var(--dim-rgb));font-size:.86rem;line-height:1.5',
          [...TYPE, 'color', 'margin-bottom'],
        )
        await expectStyle(
          page,
          themeCase,
          'dialog > div',
          'display:flex;gap:.5rem;justify-content:flex-end',
          ['display', 'gap', 'justify-content'],
        )
        expect(
          await buttons.allTextContents(),
          JSON.stringify(themeCase),
        ).toEqual(['keep the run', 'abort the run'])
        for (const index of [0, 1]) {
          await expectStyle(
            page,
            themeCase,
            `dialog button:nth-child(${index + 1})`,
            buttonCss,
            [...TYPE, ...PAINT],
            ['padding-top', 'padding-right'],
          )
        }

        // when
        await buttons.nth(0).hover()

        // then
        await expectStyle(
          page,
          themeCase,
          'dialog button:first-child',
          `${buttonCss};background:rgb(var(--panel-3-rgb))`,
          ['background-color', 'border-top-color'],
        )

        // when
        await buttons.nth(1).hover()

        // then
        await expectStyle(
          page,
          themeCase,
          'dialog button:last-child',
          `${buttonCss};background:rgb(var(--fail-rgb) / .22)`,
          ['background-color'],
        )

        // when
        await page.mouse.move(0, 0)
        const actualBackdrop = await page.screenshot({
          clip: { x: 0, y: 0, width: 1, height: 1 },
        })
        // This legacy scrim is deliberately independent of theme hue.
        const reference = await page.addStyleTag({
          content:
            'dialog::backdrop { background:rgb(0 0 0 / .55) !important; filter:none !important; }',
        })
        try {
          const legacyBackdrop = await page.screenshot({
            clip: { x: 0, y: 0, width: 1, height: 1 },
          })

          // then
          expect(actualBackdrop, JSON.stringify(themeCase)).toEqual(
            legacyBackdrop,
          )
        } finally {
          await reference.evaluate((element) =>
            element.parentNode?.removeChild(element),
          )
        }
      })
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1 a native destructive confirmation',
    'when it opens and Enter is pressed',
    'it should initially focus cancellation and close without confirming',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const dialog = page.locator('dialog')
      const cancel = dialog.getByRole('button', { name: 'keep the run' })

      // when
      await page.locator('#open-dialog').click()
      const cancellationInitiallyFocused = await cancel.evaluate(
        (element) => document.activeElement === element,
      )
      await page.keyboard.press('Enter')

      // then
      expect(cancellationInitiallyFocused).toBe(true)
      expect(await page.locator('#result').textContent()).toBe('cancelled')
      expect(await dialog.isVisible()).toBe(false)
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1 an open native destructive confirmation',
    'when Tab and Shift+Tab move focus before Tab and Enter choose confirmation',
    'it should return focus to cancellation and permit explicit keyboard confirmation',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const dialog = page.locator('dialog')
      const cancel = dialog.getByRole('button', { name: 'keep the run' })
      const confirm = dialog.getByRole('button', { name: 'abort the run' })
      await page.locator('#open-dialog').click()

      // when
      await page.keyboard.press('Tab')
      const confirmationFocused = await confirm.evaluate(
        (element) => document.activeElement === element,
      )
      await page.keyboard.press('Shift+Tab')
      const cancellationRefocused = await cancel.evaluate(
        (element) => document.activeElement === element,
      )
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')

      // then
      expect(confirmationFocused).toBe(true)
      expect(cancellationRefocused).toBe(true)
      expect(await page.locator('#result').textContent()).toBe('confirmed')
      expect(await dialog.isVisible()).toBe(false)
    })
  },
  30_000,
)

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.4.1 an open native destructive confirmation',
    'when the backdrop is clicked and Escape is pressed',
    'it should ignore the backdrop and cancel only on Escape',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const dialog = page.locator('dialog')
      await page.locator('#open-dialog').click()

      // when
      await page.mouse.click(0, 0)
      const afterBackdrop = {
        visible: await dialog.isVisible(),
        result: await page.locator('#result').textContent(),
      }
      await page.keyboard.press('Escape')

      // then
      expect(afterBackdrop.visible).toBe(true)
      expect(afterBackdrop.result).toBe('pending')
      expect(await page.locator('#result').textContent()).toBe('cancelled')
      expect(await dialog.isVisible()).toBe(false)
    })
  },
  30_000,
)

for (const [tier, width] of Object.entries(viewportWidths)) {
  test.skipIf(!hasChromium)(
    [
      `given issue #86 §1.2.6 shared components at the ${tier} tier`,
      'when a parent narrows the token notice and a long detail title and the dialog opens',
      'it should keep caller content and controls inside their panels without document overflow',
    ].join(', '),
    async () => {
      // given
      await withComponents(async (page) => {
        // when
        await page.setViewportSize({
          width,
          height: devices['iPhone SE'].viewport.height,
        })
        const containment = await page
          .locator(
            '#narrow-panel section, #narrow-panel form, #narrow-detail button, #narrow-detail button > span:nth-child(2)',
          )
          .evaluateAll((elements) =>
            elements.map((element) => ({
              tag: element.tagName,
              visible:
                element.getBoundingClientRect().width > 0 &&
                element.getBoundingClientRect().height > 0,
              overflowX: element.scrollWidth - element.clientWidth,
              overflowY: element.scrollHeight - element.clientHeight,
            })),
          )
        await page.locator('#open-dialog').click()
        const modal = await page.locator('dialog').evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            left: bounds.left,
            right: bounds.right,
            overflowX: element.scrollWidth - element.clientWidth,
            overflowY: element.scrollHeight - element.clientHeight,
          }
        })
        const documentOverflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        )
        // then
        expect(containment).toHaveLength(5)
        expect(
          containment.filter(
            ({ visible, overflowX, overflowY }) =>
              !visible || overflowX > 1 || overflowY > 1,
          ),
        ).toEqual([])
        expect(modal.left).toBeGreaterThanOrEqual(0)
        expect(modal.right).toBeLessThanOrEqual(width)
        expect(modal.overflowX).toBeLessThanOrEqual(1)
        expect(modal.overflowY).toBeLessThanOrEqual(1)
        expect(documentOverflow).toBeLessThanOrEqual(0)
      })
    },
    30_000,
  )
}

test.skipIf(!hasChromium)(
  [
    'given issue #86 §1.2.6 a TokenNotice inside a narrow parent at the xl tier',
    'when only the parent expands while the viewport stays unchanged',
    'it should change from stacked controls to an aligned row using the available parent width',
  ].join(', '),
  async () => {
    // given
    await withComponents(async (page) => {
      const readControls = () =>
        page
          .locator(
            '#narrow-notice label, #narrow-notice input, #narrow-notice button',
          )
          .evaluateAll((elements) =>
            elements.map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                center: (rect.top + rect.bottom) / 2,
              }
            }),
          )
      const stacked = await readControls()
      // when
      await page
        .locator('#narrow-panel')
        .evaluate((element) => element.setAttribute('style', 'width:100%'))
      const row = await readControls()
      // then
      expect(stacked).toHaveLength(3)
      expect(row).toHaveLength(3)
      expect(stacked[0]?.bottom).toBeLessThanOrEqual(
        stacked[1]?.top ?? Number.NaN,
      )
      expect(stacked[1]?.bottom).toBeLessThanOrEqual(
        stacked[2]?.top ?? Number.NaN,
      )
      expect(row[0]?.right).toBeLessThanOrEqual(row[1]?.left ?? Number.NaN)
      expect(row[1]?.right).toBeLessThanOrEqual(row[2]?.left ?? Number.NaN)
      expect(row[0]?.center).toBeCloseTo(row[1]?.center ?? Number.NaN, 1)
      expect(row[1]?.center).toBeCloseTo(row[2]?.center ?? Number.NaN, 1)
    })
  },
  30_000,
)
