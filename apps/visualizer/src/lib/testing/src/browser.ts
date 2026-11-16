import { existsSync } from 'node:fs'
import type { Browser, BrowserContextOptions, Page } from 'playwright'
import type { ViteDevServer } from 'vite'
import { startHarnessServer } from './harness-server'
import {
  hasExecutable,
  integrationTestsEnabled,
  openSuiteWith,
  reportUnavailableBrowser,
} from './integration'

export const launchChromium = async (): Promise<Browser> =>
  (await import('playwright')).chromium.launch()

const chromiumInstalled = async (): Promise<boolean> => {
  const { chromium } = await import('playwright')
  return hasExecutable(existsSync)(() => chromium.executablePath())
}

export const browserTestsEnabled =
  integrationTestsEnabled && (await chromiumInstalled())

// biome-ignore lint/suspicious/noConsole: this process-boundary helper must report an unavailable browser rather than silently skip integration checks.
reportUnavailableBrowser(console.warn)(
  integrationTestsEnabled,
  browserTestsEnabled,
)

/**
 * One Chromium and one Vite dev server, shared by every test in a file.
 *
 * Each test still gets its own browser context through `withSuitePage`, so
 * storage, cookies, routes and emulated media do not carry between tests.
 * What is shared is the cost of starting the two processes, which is paid
 * once per file rather than once per test.
 */
export type TBrowserSuite = Readonly<{
  browser: Browser
  server: ViteDevServer
  base: string
}>

/** Start the browser and the harness server; the caller closes both. */
export const openBrowserSuite = (
  options: Readonly<{ apiTarget?: string }> = {},
): Promise<TBrowserSuite> =>
  openSuiteWith({
    launch: launchChromium,
    start: () => startHarnessServer(options),
  })()

/** Close what `openBrowserSuite` started; nothing when it never opened. */
export const closeBrowserSuite = async (
  suite: TBrowserSuite | undefined,
): Promise<void> => {
  await suite?.browser.close()
  await suite?.server.close()
}

/**
 * Run `check` in a fresh context and page of the suite's browser, closing the
 * context afterwards whether or not `check` succeeded. Rejects when the suite
 * was never opened, which only happens when a test runs although
 * `browserTestsEnabled` is false.
 */
export const withSuitePage =
  (suite: TBrowserSuite | undefined) =>
  async <T>(
    options: Readonly<BrowserContextOptions>,
    check: (page: Page, suite: TBrowserSuite) => Promise<T>,
  ): Promise<T> => {
    if (suite === undefined) {
      return Promise.reject(
        new Error('the browser suite is not open: browser tests are disabled'),
      )
    }
    const context = await suite.browser.newContext(options)
    try {
      return await check(await context.newPage(), suite)
    } finally {
      await context.close()
    }
  }
