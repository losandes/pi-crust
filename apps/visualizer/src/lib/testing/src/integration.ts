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

export const canLaunch =
  (launch: () => Promise<Readonly<{ close: () => Promise<void> }>>) =>
  (): Promise<boolean> =>
    launch().then(
      async (browser) => {
        await browser.close()
        return true
      },
      () => false,
    )
