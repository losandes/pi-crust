import { afterAll, expect, test } from 'bun:test'
import type { BrowserContext, Page } from 'playwright'
import {
  browserTestsEnabled,
  closeBrowserSuite,
  openBrowserSuite,
} from '@/lib/testing'
import type { SessionSummary } from '../typedefs/session'

const HARNESS_HTML = `<!doctype html>
<html><body>
<div id="app"></div>
<script type="module" src="/src/domains/sessions/src/_components/__fixtures__/filters-harness.tsx"></script>
</body></html>`

const now = Date.now()
const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString()

const session = (overrides: Partial<SessionSummary>): SessionSummary => ({
  run_id: 'run-base',
  lifecycle: 'plan',
  request: null,
  status: 'success',
  engineer: null,
  started_at: iso(60_000),
  ended_at: iso(0),
  total_tokens: 100,
  total_cost: 0.1,
  archived: 0,
  workspace_root: '/repo/a',
  branch: 'main',
  name: null,
  repository_root:
    overrides.workspace === 'beta'
      ? '/projects/b/shared'
      : '/projects/a/shared',
  repository: 'shared',
  workspace: 'alpha',
  activityRuns: [],
  activity_run_count: 0,
  agents: [],
  ...overrides,
})

const BASE_SESSIONS: readonly SessionSummary[] = [
  session({
    run_id: 'run-1',
    workspace: 'alpha',
    lifecycle: 'plan',
    branch: 'main',
    status: 'success',
  }),
  session({
    run_id: 'run-2',
    workspace: 'beta',
    lifecycle: 'build',
    branch: 'feature',
    status: 'fail',
  }),
  session({
    run_id: 'run-3',
    workspace: 'alpha',
    lifecycle: 'build',
    branch: 'feature',
    status: 'success',
  }),
  session({
    run_id: 'run-4',
    workspace: 'beta',
    lifecycle: 'plan',
    branch: 'main',
    status: 'fail',
  }),
]

const ARCHIVED_SESSION: SessionSummary = session({
  run_id: 'run-5-archived',
  workspace: 'alpha',
  lifecycle: 'plan',
  branch: 'main',
  status: 'success',
  archived: 1,
})

const ACTION_TIMEOUT_MS = 8_000

const suite = browserTestsEnabled ? await openBrowserSuite() : undefined
// shared-process: one browser and dev server per file; each test opens its own context
afterAll(() => closeBrowserSuite(suite), 30_000)

/**
 * One attempt at mounting the fixture and handing it to `run`, bounded so a
 * hung page fails fast enough for a retry rather than burning the whole
 * test's timeout.
 */
const attemptPage = async (
  context: BrowserContext,
  base: string,
  run: (page: Page, base: string) => Promise<void>,
) => {
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS)
  await page.route('**/__diag__/index.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
  )
  // Registered FIRST: Playwright matches the most recently registered route
  // first, so this catches every other /api/* call (the per-card events
  // poll) before it reaches a real server that isn't running.
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: { ok: true, poll_ms: 500, redact_paths: false, home_dir: '' },
    }),
  )
  await page.route('**/api/sessions*', (route) => {
    const url = new URL(route.request().url())
    const sessions =
      url.searchParams.get('include_archived') === '1'
        ? [...BASE_SESSIONS, ARCHIVED_SESSION]
        : BASE_SESSIONS
    return route.fulfill({ json: sessions })
  })
  await page.goto(`${base}/__diag__/index.html`)
  await page.waitForSelector('a[href*="run-1"]')
  await run(page, base)
}

/**
 * Rejects after `ms` so a hang anywhere inside `attemptPage` cannot silently
 * consume a whole test's budget.
 */
const withTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ])

/**
 * The file shares one server and browser; each attempt gets its own context.
 * Retain one retry with a fresh context, closing each attempt before starting
 * the next.
 */
const withPage = async (run: (page: Page, base: string) => Promise<void>) => {
  if (suite === undefined) {
    throw new Error('the browser suite is not open: browser tests are disabled')
  }
  let lastError: unknown
  for (const attempt of [1, 2]) {
    const context = await suite.browser.newContext()

    // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, converting a torn-down or hung page into one retry rather than failing the test on resource contention outside this file's control
    try {
      await withTimeout(
        attemptPage(context, suite.base, run),
        12_000,
        `withPage attempt ${attempt}`,
      )
      return
    } catch (cause) {
      lastError = cause
    } finally {
      await context.close()
    }
  }
  throw lastError
}

const cardCount = (page: Page) => page.locator('a[href*="run-"]').count()

/** Polls (the 500ms interval this app polls on) until a condition holds. */
const waitFor = async (check: () => Promise<boolean>, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() >= deadline) throw new Error('condition never became true')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

test.skipIf(!browserTestsEnabled)(
  [
    'given active and archived sessions',
    'when the state panel selects archived sessions',
    'it should reveal the archived run that was hidden by default',
  ].join(', '),
  async () => {
    await withPage(async (page) => {
      // given
      expect(await cardCount(page)).toBe(4)

      // when
      await page.getByRole('button', { name: 'state' }).click()
      await page.getByRole('checkbox', { name: 'archived' }).click()

      // then
      await waitFor(async () => (await cardCount(page)) === 5)
      expect(await page.locator('a[href*="run-5-archived"]').count()).toBe(1)
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given sessions from two trees',
    'when selecting one tree option',
    'it should narrow the list and leave the panel open',
  ].join(', '),
  async () => {
    await withPage(async (page) => {
      // given
      expect(await cardCount(page)).toBe(4)

      // when
      await page.getByRole('button', { name: 'tree' }).click()
      await page.getByRole('checkbox', { name: 'alpha' }).click()

      // then
      await waitFor(async () => (await cardCount(page)) === 2)
      expect(
        await page.getByRole('checkbox', { name: 'alpha' }).isVisible(),
      ).toBe(true)
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given an open tree filter panel',
    'when clicking the background',
    'it should close the panel without changing the list',
  ].join(', '),
  async () => {
    await withPage(async (page) => {
      // given
      await page.getByRole('button', { name: 'tree' }).click()
      expect(
        await page.getByRole('checkbox', { name: 'alpha' }).isVisible(),
      ).toBe(true)

      // when
      await page.locator('body').click({ position: { x: 5, y: 400 } })

      // then
      expect(await page.getByRole('checkbox', { name: 'alpha' }).count()).toBe(
        0,
      )
      expect(await cardCount(page)).toBe(4)
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given an open tree filter panel with two options',
    'when typing in the search box',
    'it should narrow the option rows without touching the result set',
  ].join(', '),
  async () => {
    await withPage(async (page) => {
      // given
      await page.getByRole('button', { name: 'tree' }).click()
      expect(
        await page.getByRole('checkbox', { name: 'alpha' }).isVisible(),
      ).toBe(true)
      expect(
        await page.getByRole('checkbox', { name: 'beta' }).isVisible(),
      ).toBe(true)

      // when — pressSequentially rather than fill: a no-op lint rule would
      // otherwise read this Locator method as Array.prototype.fill
      await page
        .getByRole('searchbox', { name: 'search tree' })
        .pressSequentially('alpha')

      // then
      expect(
        await page.getByRole('checkbox', { name: 'alpha' }).isVisible(),
      ).toBe(true)
      expect(await page.getByRole('checkbox', { name: 'beta' }).count()).toBe(0)
      expect(await cardCount(page)).toBe(4)
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given a selected tree filter',
    'when reloading the same page',
    'it should preserve the selection',
  ].join(', '),
  async () => {
    await withPage(async (page, base) => {
      // given
      await page.getByRole('button', { name: 'tree' }).click()
      await page.getByRole('checkbox', { name: 'alpha' }).click()
      await waitFor(async () => (await cardCount(page)) === 2)

      // when
      await page.goto(`${base}/__diag__/index.html`)
      await page.waitForSelector('a[href*="run-1"]')

      // then
      await waitFor(async () => (await cardCount(page)) === 2)
      expect(
        await page.getByRole('button', { name: 'tree · 1' }).isVisible(),
      ).toBe(true)
    })
  },
  30_000,
)

test.skipIf(!browserTestsEnabled)(
  [
    'given two repository paths with the same final segment',
    'when searching and selecting the repository filter',
    'it should label options by segment but search and filter by their full paths',
  ].join(', '),
  async () => {
    await withPage(async (page) => {
      // given
      await page
        .getByRole('button', { name: 'repository', exact: true })
        .click()
      expect(
        await page
          .locator('label')
          .getByTitle('/projects/a/shared', { exact: true })
          .textContent(),
      ).toBe('shared')
      // when
      await page
        .getByRole('searchbox', { name: 'search repository' })
        .pressSequentially('/projects/b')
      // then
      expect(
        await page
          .locator('label')
          .getByTitle('/projects/a/shared', { exact: true })
          .count(),
      ).toBe(0)
      expect(
        await page
          .locator('label')
          .getByTitle('/projects/b/shared', { exact: true })
          .count(),
      ).toBe(1)
      await page
        .getByRole('searchbox', { name: 'search repository' })
        .press('ControlOrMeta+A')
      await page
        .getByRole('searchbox', { name: 'search repository' })
        .press('Backspace')
      await page
        .locator('label')
        .getByTitle('/projects/a/shared', { exact: true })
        .locator('..')
        .getByRole('checkbox')
        .click()
      await waitFor(async () => (await cardCount(page)) === 2)
      expect(
        await page.getByRole('button', { name: 'repository · 1' }).isVisible(),
      ).toBe(true)
    })
  },
  30_000,
)
