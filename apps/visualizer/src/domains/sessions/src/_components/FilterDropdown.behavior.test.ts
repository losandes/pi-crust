import { afterAll, expect, test } from 'bun:test'
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { startHarnessServer } from '@/lib/testing'
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

/*
 * Playwright's Chromium is a ~99MB download and is not vendored. On a machine
 * without it this says so and skips, rather than failing a verification
 * command AGENTS.md tells people to run on a fresh clone. A skip is a check
 * not run, not a check that passed.
 */
const initialBrowser: Browser | undefined = await chromium
  .launch()
  .catch(() => undefined)
const browser = initialBrowser
if (browser === undefined) {
  console.warn(
    'FilterDropdown.behavior.test.ts: no Chromium — skipping. Run `bunx playwright install chromium`.',
  )
}

/*
 * Held as a mutable reference rather than the `const browser` above: when the
 * whole repository's suite runs together, four files
 * (`SessionCard.layout.test.ts`, `ActivityRunDetail.layout.test.ts`,
 * `ThemePicker.interaction.test.ts` and this one) each launch Chromium and
 * run real browsers concurrently with over 900 other tests, and under that
 * load a Chromium instance can be torn down between two tests in the same
 * file for reasons outside this file's control. `withPage` below relaunches
 * rather than trusting one browser to outlive every test in this file.
 */
let liveBrowser = initialBrowser

afterAll(async () => {
  await liveBrowser?.close()
  await server.close()
})

/*
 * One Vite dev server for the whole file, not one per test. Each test used
 * to pay for its own listen/close cycle, which left this file (and the
 * Chromium instances the other three harness files launch at the same time,
 * in the same `bun test` process) competing for process teardown for
 * several seconds longer than the assertions themselves take — long
 * enough, under load, to blow the 5s default hook timeout on `afterAll` in
 * one of these files, or to tear a browser down mid-test. A fresh browser
 * context per test gives each one a clean `sessionStorage` without a new
 * server.
 */
const { server, base: BASE } = await startHarnessServer()

/** Relaunches when the previous Chromium instance is no longer connected. */
const ensureBrowser = async (): Promise<Browser | undefined> => {
  if (liveBrowser?.isConnected()) return liveBrowser
  liveBrowser = await chromium.launch().catch(() => undefined)
  return liveBrowser
}

const ACTION_TIMEOUT_MS = 8_000

/**
 * One attempt at mounting the fixture and handing it to `run`, bounded so a
 * hung page fails fast enough for a retry rather than burning the whole
 * test's timeout.
 */
const attemptPage = async (
  activeBrowser: Browser,
  run: (page: Page, base: string) => Promise<void>,
) => {
  const context: BrowserContext = await activeBrowser.newContext()
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS)
  try {
    await page.route('**/__diag__/index.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
    )
    // Registered FIRST: Playwright matches the most recently registered route
    // first, so this catches every other /api/* call (the per-card events
    // poll) before it reaches a real server that isn't running.
    await page.route('**/api/**', (route) => route.fulfill({ json: [] }))
    await page.route('**/api/sessions*', (route) => {
      const url = new URL(route.request().url())
      const sessions =
        url.searchParams.get('include_archived') === '1'
          ? [...BASE_SESSIONS, ARCHIVED_SESSION]
          : BASE_SESSIONS
      return route.fulfill({ json: sessions })
    })
    await page.goto(`${BASE}/__diag__/index.html`)
    await page.waitForSelector('a[href*="run-1"]')
    await run(page, BASE)
  } finally {
    await context.close()
  }
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
 * One fresh context (and so a fresh `sessionStorage`) per test, retried
 * against a freshly launched Chromium when the first attempt's browser turns
 * out to have been torn down or hangs — see the comment on `liveBrowser`
 * above. Under the load of the whole repository's suite, both have been
 * observed; a single retry with a fresh browser has recovered from either.
 */
const withPage = async (run: (page: Page, base: string) => Promise<void>) => {
  const attempts = [0, 1]
  let lastError: unknown

  for (const attempt of attempts) {
    if (attempt > 0) liveBrowser = undefined
    const activeBrowser = await ensureBrowser()
    if (activeBrowser === undefined)
      throw new Error('Chromium is no longer available')

    // biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary, converting a torn-down or hung browser into one retry rather than failing the test on resource contention outside this file's control
    try {
      await withTimeout(
        attemptPage(activeBrowser, run),
        12_000,
        'withPage attempt',
      )
      return
    } catch (cause) {
      lastError = cause
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

test.skipIf(browser === undefined)(
  'the archived run is hidden by default and appears once the state panel selects it',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
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

test.skipIf(browser === undefined)(
  'selecting a tree option narrows the list and leaves the panel open',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
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

test.skipIf(browser === undefined)(
  'clicking the background closes the open panel without changing the list',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
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

test.skipIf(browser === undefined)(
  'typing in the search box narrows the option rows without touching the result set',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
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

test.skipIf(browser === undefined)(
  'a selection survives a same-page reload',
  async () => {
    if (browser === undefined) return // unreachable; narrows the type for tsc
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
