import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  buildProductionCss,
  launchChromium,
  phoneViewport,
  settleTransitions,
  startHarnessServer,
  viewportWidths,
} from '@/lib/testing'

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

const productionCss = browserTestsEnabled ? await buildProductionCss() : ''

const withShell = async (check: (page: Page) => Promise<void>) => {
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

for (const route of [
  { hash: '#/', current: 'sessions' },
  { hash: '#/4dafe46c', current: '4dafe46c' },
  { hash: '#/worktree:4dafe46c', current: 'worktree · 4dafe46c' },
  {
    hash: '#/worktree:4dafe46c/4dafe46c_03_build',
    current: '4dafe46c_03_build',
  },
]) {
  test.skipIf(!browserTestsEnabled)(
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
for (const tier of ['base', 'xl'] as const) {
  const width = viewportWidths[tier]
  test.skipIf(!browserTestsEnabled)(
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
          height: phoneViewport.height,
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

for (const journey of [
  { scope: 'unscoped', runHref: '#/4dafe46c', runLabel: '4dafe46c' },
  {
    scope: 'workspace-scoped',
    runHref: '#/feature-worktree:4dafe46c',
    runLabel: 'feature-worktree · 4dafe46c',
  },
]) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given issue #87 §1.3.1 and §1.5.1 ${journey.scope} activity breadcrumbs`,
      'when navigating breadcrumb ancestors with Enter and returning with browser history',
      'it should preserve destinations and move the sole current-page marker to the displayed page',
    ].join(', '),
    async () => {
      // given
      await withShell(async (page) => {
        const activity = '4dafe46c_03_build'
        const nav = page.getByRole('navigation')
        const readBreadcrumb = () =>
          nav.evaluate((element) => ({
            links: Array.from(element.querySelectorAll('a'), (link) => ({
              label: link.textContent ?? '',
              href: link.getAttribute('href') ?? undefined,
              current: link.hasAttribute('aria-current'),
            })),
            current: Array.from(
              element.querySelectorAll('[aria-current]'),
              (segment) => ({
                label: segment.textContent ?? '',
                value: segment.getAttribute('aria-current') ?? undefined,
              }),
            ),
          }))
        await page.goto(
          `${page.url().split('#')[0]}${journey.runHref}/${activity}`,
        )
        await nav.getByText(activity, { exact: true }).waitFor()
        const initial = await readBreadcrumb()

        // when
        await nav
          .getByRole('link', { name: journey.runLabel, exact: true })
          .press('Enter')
        await page.waitForFunction(
          (label) =>
            document.querySelector('nav > :last-child')?.textContent === label,
          journey.runLabel,
        )
        const run = await readBreadcrumb()
        await nav
          .getByRole('link', { name: 'sessions', exact: true })
          .press('Enter')
        await page.waitForFunction(
          () => document.querySelectorAll('nav a').length === 1,
        )
        const sessions = await readBreadcrumb()
        await page.goBack()
        await page.waitForFunction(
          (label) =>
            document.querySelector('nav > :last-child')?.textContent === label,
          journey.runLabel,
        )
        const returned = await readBreadcrumb()

        // then
        expect(initial.links).toEqual([
          { label: 'sessions', href: '#/', current: false },
          { label: journey.runLabel, href: journey.runHref, current: false },
        ])
        expect(initial.current).toEqual([{ label: activity, value: 'page' }])
        expect(run.links).toEqual([
          { label: 'sessions', href: '#/', current: false },
          { label: journey.runLabel, href: journey.runHref, current: true },
        ])
        expect(run.current).toEqual([
          { label: journey.runLabel, value: 'page' },
        ])
        expect(sessions).toEqual({
          links: [{ label: 'sessions', href: '#/', current: true }],
          current: [{ label: 'sessions', value: 'page' }],
        })
        expect(returned).toEqual(run)
        expect(await page.getByRole('main').textContent()).toBe(
          'Shell-only fixture',
        )
      })
    },
    30_000,
  )
}

for (const route of [
  { kind: 'run', suffix: '', current: `${longWorkspace} · ${longRun}` },
  { kind: 'activity', suffix: `/${longActivity}`, current: longActivity },
]) {
  test.skipIf(!browserTestsEnabled)(
    [
      `given issue #87 §1.3.3 and §1.5.1 a long ${route.kind} breadcrumb at the base tier`,
      'when the theme picker opens beside the breadcrumb',
      'it should keep the brand, live indicator and theme control visible without overlap or offscreen controls',
    ].join(', '),
    async () => {
      // given
      await withShell(async (page) => {
        await page.setViewportSize({
          width: viewportWidths.base,
          height: phoneViewport.height,
        })
        await page.goto(
          `${page.url().split('#')[0]}#/${longWorkspace}:${longRun}${route.suffix}`,
        )
        await page.waitForFunction(
          (label) =>
            document.querySelector('nav > :last-child')?.textContent === label,
          route.current,
        )
        const readChrome = () =>
          page
            .locator('header nav, header > div > span, header button')
            .evaluateAll((elements) => ({
              documentWidth: document.documentElement.scrollWidth,
              viewport: window.innerWidth,
              boxes: elements.map((element) => {
                const bounds = element.getBoundingClientRect()
                return {
                  tag: element.tagName,
                  left: bounds.left,
                  right: bounds.right,
                  top: bounds.top,
                  bottom: bounds.bottom,
                  width: bounds.width,
                  height: bounds.height,
                }
              }),
            }))
        const closed = await readChrome()

        // when
        await page.getByRole('button', { name: /^Theme:/ }).click()
        const opened = await readChrome()
        const liveIsVisible = await page
          .getByText('live', { exact: true })
          .isVisible()
        const brandIsVisible = await page
          .getByText('pi-crust', { exact: true })
          .isVisible()

        // then
        expect(
          liveIsVisible,
          'the live indicator must not be hidden to make the bar fit',
        ).toBe(true)
        expect(brandIsVisible).toBe(true)
        expect(
          await page.getByRole('img', { name: 'pi-crust logo' }).isVisible(),
        ).toBe(true)
        expect(await page.getByRole('listbox').isVisible()).toBe(true)
        expect(
          await page.locator('nav [aria-current="page"]').textContent(),
        ).toBe(route.current)
        for (const chrome of [closed, opened]) {
          expect(chrome.documentWidth).toBeLessThanOrEqual(chrome.viewport + 1)
          expect(chrome.boxes).toHaveLength(3)
          for (const box of chrome.boxes) {
            expect(box.width, box.tag).toBeGreaterThan(0)
            expect(box.height, box.tag).toBeGreaterThan(0)
            expect(box.left, box.tag).toBeGreaterThanOrEqual(0)
            expect(box.right, box.tag).toBeLessThanOrEqual(chrome.viewport + 1)
          }
          const overlaps = chrome.boxes.flatMap((box, index, boxes) =>
            boxes
              .slice(index + 1)
              .flatMap((other) =>
                Math.min(box.right, other.right) -
                  Math.max(box.left, other.left) >
                  1 &&
                Math.min(box.bottom, other.bottom) -
                  Math.max(box.top, other.top) >
                  1
                  ? [[box.tag, other.tag]]
                  : [],
              ),
          )
          expect(
            overlaps,
            'breadcrumb and controls must not cover one another',
          ).toEqual([])
        }
      })
    },
    30_000,
  )
}

test.skipIf(!browserTestsEnabled)(
  [
    'given issue #87 §1.2.3 the mounted live indicator',
    'when reduced motion is enabled and then disabled',
    'it should preserve the app-owned pulse depth, duration and easing while honoring reduced motion',
  ].join(', '),
  async () => {
    // given
    await withShell(async (page) => {
      const dot = page.getByText('live', { exact: true }).locator('span')
      const readMotion = () =>
        dot.evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            name: style.animationName,
            durationMs: Number.parseFloat(style.animationDuration) * 1000,
            easing: style.animationTimingFunction,
            iterations: style.animationIterationCount,
          }
        })
      const normal = await readMotion()
      const opacities = await dot.evaluate((element) => {
        const [animation] = element.getAnimations()
        const duration = animation?.effect?.getComputedTiming().duration
        if (!animation || typeof duration !== 'number') {
          throw new Error('Missing animation on the mounted live indicator')
        }
        animation.pause()
        try {
          return [0, 0.5, 1].map((progress) => {
            // biome-ignore lint/plugin/no-object-mutation: seeking a browser-owned Animation requires its currentTime setter.
            animation.currentTime = duration * progress
            return Number(getComputedStyle(element).opacity)
          })
        } finally {
          animation.play()
        }
      })

      // when
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const reduced = await readMotion()
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const restored = await readMotion()

      // then
      expect(normal).toEqual({
        name: 'crust-pulse',
        durationMs: 1600,
        easing: 'ease-in-out',
        iterations: 'infinite',
      })
      expect(opacities).toEqual([1, 0.35, 1])
      expect(reduced).toEqual({
        name: 'crust-pulse',
        durationMs: expect.closeTo(0.01, 5),
        easing: 'ease-in-out',
        iterations: '1',
      })
      expect(restored).toEqual(normal)
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given issue #87 §1.4.2 and §1.5.1 the shell with Auto chosen through its picker',
    'when the system colour scheme changes before and after an explicit Dark choice',
    'it should repaint Auto without reselection and leave the explicit choice unchanged',
  ].join(', '),
  async () => {
    // given
    await withShell(async (page) => {
      const readTheme = () =>
        page.locator('header').evaluate((element) => ({
          choice:
            document.documentElement.getAttribute('data-theme-choice') ??
            undefined,
          resolved:
            document.documentElement.getAttribute('data-theme') ?? undefined,
          background: getComputedStyle(element).backgroundColor,
        }))
      await page
        .getByRole('button', { name: 'Theme: Auto', exact: true })
        .click()
      await page.getByRole('option', { name: 'Auto', exact: true }).click()
      await settleTransitions(page)
      const autoDark = await readTheme()

      // when
      await page.emulateMedia({ colorScheme: 'light' })
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'light',
      )
      await settleTransitions(page)
      const autoLight = await readTheme()
      await page
        .getByRole('button', { name: 'Theme: Auto', exact: true })
        .click()
      await page.getByRole('option', { name: 'Dark', exact: true }).click()
      await settleTransitions(page)
      const explicitDark = await readTheme()
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      await settleTransitions(page)
      const unchanged = await readTheme()

      // then
      expect(autoDark.choice).toBe('auto')
      expect(autoDark.resolved).toBe('dark')
      expect(autoLight.choice).toBe('auto')
      expect(autoLight.resolved).toBe('light')
      expect(
        autoLight.background,
        'Auto must repaint the topbar, not only its data-theme attribute',
      ).not.toBe(autoDark.background)
      expect(explicitDark).toEqual({
        choice: 'dark',
        resolved: 'dark',
        background: autoDark.background,
      })
      expect(unchanged).toEqual(explicitDark)
      expect(
        await page
          .getByRole('button', { name: 'Theme: Dark', exact: true })
          .count(),
      ).toBe(1)
    })
  },
  30_000,
)
