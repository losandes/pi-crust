import type { Browser } from 'playwright'
import {
  canLaunch,
  integrationTestsEnabled,
  reportUnavailableBrowser,
} from './integration'

export const launchChromium = async (): Promise<Browser> =>
  (await import('playwright')).chromium.launch()

export const browserTestsEnabled =
  integrationTestsEnabled && (await canLaunch(launchChromium)())

// biome-ignore lint/suspicious/noConsole: this process-boundary helper must report an unavailable browser rather than silently skip integration checks.
reportUnavailableBrowser(console.warn)(
  integrationTestsEnabled,
  browserTestsEnabled,
)
