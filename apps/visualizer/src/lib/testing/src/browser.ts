import type { Browser } from 'playwright'
import { canLaunch, integrationTestsEnabled } from './integration'

export const launchChromium = async (): Promise<Browser> =>
  (await import('playwright')).chromium.launch()

export const browserTestsEnabled =
  integrationTestsEnabled && (await canLaunch(launchChromium)())

const INSTALL_CHROMIUM =
  'No Chromium — skipping browser tests. Run `bunx playwright install chromium` from apps/visualizer.'

const unavailable = integrationTestsEnabled && !browserTestsEnabled
// biome-ignore lint/suspicious/noConsole: this process-boundary helper must report an unavailable browser rather than silently skip integration checks.
unavailable && console.warn(INSTALL_CHROMIUM)
