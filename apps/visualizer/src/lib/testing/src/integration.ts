export const integrationEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean => env.RUN_INTEGRATION_TESTS === 'true'

export const integrationTestsEnabled = integrationEnabled(process.env)

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
