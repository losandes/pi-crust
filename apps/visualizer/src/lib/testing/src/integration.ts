import {
  safeParseSettlement,
  settleAsync,
  settledOr,
} from '@typedefs/settlement'

export const integrationEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env.RUN_INTEGRATION_TESTS === 'true'

export const integrationTestsEnabled = integrationEnabled(process.env)

export const reportUnavailableBrowser =
  (warn: (message: string) => void) =>
  (enabled: boolean, available: boolean): void => {
    if (enabled && !available) {
      warn(
        'No Chromium — skipping browser tests. Run `bunx playwright install chromium` from apps/visualizer.',
      )
    }
  }

/**
 * Whether a browser's executable is installed, decided without starting it.
 *
 * Launching a browser only to close it again cost every browser test file one
 * extra launch. A path that cannot be resolved counts as not installed. An
 * installed executable that still cannot start, such as one missing its
 * system libraries, is not detected here: its tests fail instead of skipping.
 */
export const hasExecutable =
  (exists: (path: string) => boolean) =>
  (executablePath: () => string): boolean =>
    settledOr(
      safeParseSettlement(() => exists(executablePath())),
      false,
    )

type TClosable = Readonly<{ close: () => Promise<void> }>

/**
 * Start a browser, then a server, and hand back both. When the server cannot
 * start, the browser that already started is closed before the failure is
 * passed on, so a failed open leaves no process behind.
 */
export const openSuiteWith =
  <TBrowser extends TClosable, TServer extends TClosable>(
    deps: Readonly<{
      launch: () => Promise<TBrowser>
      start: () => Promise<Readonly<{ server: TServer; base: string }>>
    }>,
  ) =>
  async (): Promise<
    Readonly<{ browser: TBrowser; server: TServer; base: string }>
  > => {
    const browser = await deps.launch()
    const harness = await settleAsync(deps.start)
    if (harness.status === 'error') {
      await browser.close()
      return Promise.reject(harness.error)
    }
    return { browser, ...harness.data }
  }
