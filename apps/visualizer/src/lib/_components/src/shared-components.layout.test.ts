import { expect, test } from 'bun:test'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  buildProductionCss,
  launchChromium,
  phoneViewport,
  startHarnessServer,
  viewportWidths,
} from '@/lib/testing'

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="fixture" style="padding:1rem"></div>
<script type="module">
import { createElement as h, Fragment, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Activity } from 'lucide-react'
import '/src/style.css'
import { applyTheme } from '/src/domains/themes/index.ts'
import { readToken } from '/src/lib/api-client/index.ts'
import { DetailSection, TokenNotice, ConfirmDialog } from '/src/lib/_components/index.ts'
applyTheme(document.documentElement, 'dark', window.matchMedia)
const wrap = (id, child) => h('div', { id, key: id }, child)
const notice = (onSaved) => h(TokenNotice, {
  problem: 'The server refused this write. Paste its token to try again.', onSaved,
})
function Fixture() {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [result, setResult] = useState('pending')
  return h(Fragment, undefined,
    wrap('detail', h(DetailSection, {
      title: 'Run context', icon: Activity, count: 0, open: expanded,
      onToggle: () => setExpanded((value) => !value),
    }, h('p', undefined, 'Caller-provided details'))),
    wrap('notice', notice(() => setResult('saved ' + readToken()))),
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

// Build once without writing output. Development CSS must not hide a utility
// omitted by the production scanner (issue #86, requirements 1.2.2–1.2.3).
const productionCss = browserTestsEnabled ? await buildProductionCss() : ''

const withComponents = async (check: (page: Page) => Promise<void>) => {
  const { server, base } = await startHarnessServer()
  try {
    const browser = await launchChromium()
    try {
      const page = await browser.newPage({
        viewport: {
          width: viewportWidths.xl,
          height: phoneViewport.height,
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
      await check(page)
    } finally {
      await browser.close()
    }
  } finally {
    await server.close()
  }
}

test.skipIf(!browserTestsEnabled)(
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
      expect(await header.textContent()).toContain('(0)')
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
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
      expect(
        await page.locator('#notice section').getAttribute('aria-live'),
      ).toBe('polite')
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

test.skipIf(!browserTestsEnabled)(
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

test.skipIf(!browserTestsEnabled)(
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

test.skipIf(!browserTestsEnabled)(
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

for (const tier of ['base', 'xl'] as const) {
  const width = viewportWidths[tier]
  test.skipIf(!browserTestsEnabled)(
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
          height: phoneViewport.height,
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

test.skipIf(!browserTestsEnabled)(
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
