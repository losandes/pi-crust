import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright'
import {
  browserTestsEnabled,
  launchChromium,
  phoneViewport,
  startHarnessServer,
  viewportWidths,
} from '@/lib/testing'
import { createTracer } from '../../../../../../../runtime/domains/trace'
import { insertActivityRun } from '../../../../../server/trace-db-fixture.test'

const waitForAddress = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  output = '',
): Promise<string> => {
  const address = output.match(/visualizer api\s+(http:\/\/localhost:\d+)/)?.[1]
  if (address) return address.replace('localhost', '127.0.0.1')
  const next = await reader.read()
  if (next.done) throw new Error(`API exited before listening: ${output}`)
  return waitForAddress(reader, output + new TextDecoder().decode(next.value))
}

const waitForChildren = async (
  path: string,
  remaining = 200,
): Promise<readonly string[]> => {
  const lines = existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n')
    : []
  if (lines.length === 8) return lines
  if (remaining === 0)
    throw new Error(`Expected 8 child receipts, got ${lines.length}`)
  await Bun.sleep(20)
  return waitForChildren(path, remaining - 1)
}

const typeInstruction = async (page: Page, text: string) => {
  await page.locator('textarea:visible').focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}

const submit = async (
  page: Page,
  label: string,
  path: string,
  expected: Readonly<Record<string, unknown>>,
) => {
  const received = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith(path),
  )
  await page.getByRole('button', { name: label, exact: true }).click()
  const response = await received
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual(expected)
  expect(response.request().headers()['x-crust-token']).toBe('disposable-token')
  return response.json()
}

test.skipIf(!browserTestsEnabled)(
  [
    'given the running visualizer and an isolated trace database',
    'when every run-control action is submitted through the browser',
    'it should reach the real HTTP handlers and record the same inbox, decisions and child arguments',
  ].join(', '),
  async () => {
    // given — real HTTP, SQLite, handoff files and child processes; no request
    // interception. Only the expensive agent/lifecycle execution is replaced
    // with deterministic argument recorders in this disposable workspace.
    const root = mkdtempSync(join(tmpdir(), 'crust-controls-http-'))
    const data = join(root, '.pi-crust', 'data')
    const db = join(data, 'crust.db')
    const runtime = join(root, 'runtime')
    mkdirSync(data, { recursive: true })
    mkdirSync(runtime)
    const config = join(root, '.pi-crust', 'config')
    mkdirSync(config)
    writeFileSync(
      join(config, 'high-contrast.css'),
      readFileSync(
        new URL(
          '../../../../../../../templates/stamp/config/high-contrast.css',
          import.meta.url,
        ),
      ),
    )
    writeFileSync(
      join(config, 'crust.observe.yaml'),
      Bun.YAML.stringify({
        default_theme: 'dark',
        themes: [
          ...['auto', 'dark', 'light'].map((name) => ({
            name,
            label: name[0]?.toUpperCase() + name.slice(1),
            builtin: true,
          })),
          {
            name: 'high-contrast',
            label: 'High contrast',
            stylesheet: 'config/high-contrast.css',
          },
        ],
      }),
    )
    const receipt = join(root, 'children.jsonl')
    const recorder = `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(receipt)}, JSON.stringify(process.argv.slice(1)) + '\\n')`
    writeFileSync(join(runtime, 'cli.ts'), recorder)
    mkdirSync(join(runtime, 'commands'))
    for (const name of ['resume', 'ask', 'amend', 'steer'])
      writeFileSync(join(runtime, 'commands', `${name}.ts`), recorder)
    const tracer = createTracer(db, join(root, 'events.jsonl'))
    const runs = ['running', 'waiting', 'failed', 'finished'] as const
    for (const runId of runs) {
      tracer.sessionStart(runId, 'browser-verification', 'disposable')
      tracer.sessionWorkspace(runId, root, 'verification')
      tracer.sessionRequest(
        runId,
        '# Verify the controls\n\nKeep every action reachable.',
      )
      if (runId === 'waiting') tracer.sessionWaiting(runId)
      if (runId === 'failed' || runId === 'finished')
        tracer.sessionFinish(runId, runId === 'finished')
      const directory = join(data, 'sessions', runId)
      mkdirSync(join(directory, 'context_handoff'), { recursive: true })
      writeFileSync(
        join(directory, 'invocation.json'),
        JSON.stringify({
          argv: ['bun', join(runtime, 'commands', 'resume.ts')],
          cwd: root,
        }),
      )
      writeFileSync(
        join(directory, 'context_handoff', 'result.md'),
        '# Result\n\nA real handoff file.',
      )
      insertActivityRun(db, {
        activity_run_id: `${runId}-build`,
        run_id: runId,
        seq: 1,
        name: 'build',
        kind: 'agent',
        owner: 'builder',
        status: 'success',
        description:
          'Verify the presentation without calling an external model.',
        started_at: new Date(Date.now() - 1000).toISOString(),
        ended_at: new Date().toISOString(),
      })
    }
    const api = Bun.spawn(
      [
        'bun',
        new URL('../../../../../server/index.ts', import.meta.url).pathname,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CRUST_DB: db,
          CRUST_BE_PORT: '0',
          CRUST_HOME: root,
          CRUST_TOKEN: 'disposable-token',
          CRUST_REGISTRY: join(root, 'absent-registry.jsonl'),
          CRUST_MACHINE_CONFIG: join(root, 'absent-config.yaml'),
          CRUST_WORKSPACES: '',
          CRUST_ALL_WORKTREES: '',
          CRUST_WORKSPACE_ROOT: root,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    try {
      const address = await waitForAddress(api.stdout.getReader())
      const { server: frontend, base } = await startHarnessServer({
        apiTarget: address,
      })
      try {
        const browser = await launchChromium()
        try {
          const page = await browser.newPage({
            viewport: {
              width: viewportWidths.xl,
              height: phoneViewport.height,
            },
          })
          page.setDefaultTimeout(10_000)
          const openRun = async (runId: string, detail = false) => {
            await page.goto(
              `${base}/#/${runId}${detail ? `/${runId}-build` : ''}`,
            )
            await page.locator('textarea:visible').waitFor()
          }

          for (const tier of ['base', 'xl'] as const) {
            await page.setViewportSize({
              width: viewportWidths[tier],
              height: phoneViewport.height,
            })
            for (const theme of ['Dark', 'Light', 'Auto', 'High contrast']) {
              await openRun('running')
              await page.getByRole('button', { name: /^Theme:/ }).click()
              await page
                .getByRole('option', { name: theme, exact: true })
                .click()
              const geometry = await page.evaluate(() => ({
                actual: document.documentElement.scrollWidth,
                available: document.documentElement.clientWidth,
              }))
              expect(geometry.actual, `${tier}: ${theme}`).toBeLessThanOrEqual(
                geometry.available,
              )
              await page
                .getByRole('button')
                .filter({ hasText: 'Result' })
                .click()
              const viewer = page
                .getByRole('dialog')
                .filter({ hasText: 'A real handoff file.' })
              await viewer.waitFor()
              const panel = await viewer.locator(':scope > div').boundingBox()
              expect(panel?.height).toBeLessThanOrEqual(phoneViewport.height)
              await page.keyboard.press('Escape')
              await openRun('failed', true)
              await typeInstruction(
                page,
                'Replay this activity with the same request payload.',
              )
              await page
                .getByRole('button', { name: 'steer from here…', exact: true })
                .click()
              await page
                .getByRole('dialog')
                .filter({ hasText: 'Send this run back to build' })
                .waitFor()
              await page.keyboard.press('Escape')
              expect(await page.locator('dialog[open]').count()).toBe(0)
            }
          }
          await page.setViewportSize({
            width: viewportWidths.xl,
            height: phoneViewport.height,
          })

          // when — message actions reach the actual inbox on disk.
          await openRun('running')
          await typeInstruction(page, 'Steer the running activity.')
          const refused = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              new URL(response.url()).pathname.endsWith('/messages'),
          )
          await page
            .getByRole('button', { name: 'steer now', exact: true })
            .click()
          expect((await refused).status()).toBe(401)
          await page.getByPlaceholder('CRUST_TOKEN').focus()
          await page.keyboard.insertText('disposable-token')
          await page
            .getByRole('button', { name: 'save token', exact: true })
            .click()
          await submit(page, 'steer now', '/messages', {
            kind: 'steer',
            message: 'Steer the running activity.',
            from: 'the web app',
          })
          await typeInstruction(page, 'Queue the follow-up.')
          await submit(page, 'queue for after', '/messages', {
            kind: 'follow_up',
            message: 'Queue the follow-up.',
            from: 'the web app',
          })
          await page.getByRole('button', { name: 'abort', exact: true }).click()
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: 'abort', exact: true }).click()
          await submit(page, 'abort the run', '/messages', {
            kind: 'abort',
            message: '',
            from: 'the web app',
          })

          // then
          const inbox = readFileSync(
            join(data, 'sessions/running/inbox.jsonl'),
            'utf8',
          )
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
          expect(inbox.map((entry) => entry.kind)).toEqual([
            'steer',
            'follow_up',
            'abort',
          ])

          // when, then — each decision is persisted before its resume starts.
          await openRun('waiting')
          for (const { label, action, text } of [
            {
              label: 'continue without answering',
              action: 'approve',
              text: '',
            },
            {
              label: 'answer and continue',
              action: 'answer',
              text: 'Use the existing behavior.',
            },
            {
              label: 'reject and send back',
              action: 'reject',
              text: 'Keep the original payload.',
            },
          ]) {
            await typeInstruction(page, text)
            await submit(page, label, '/decision', {
              action,
              text,
              from: 'the web app',
            })
            const decision = JSON.parse(
              readFileSync(
                join(
                  data,
                  'sessions/waiting/context_handoff/decision-answer.json',
                ),
                'utf8',
              ),
            )
            expect(decision.verb).toBe(action)
          }

          // when, then — finished activities retain ask, amend and both steer targets.
          await openRun('failed', true)
          await typeInstruction(page, 'Why did this fail?')
          await submit(page, 'ask', '/consult', {
            mode: 'ask',
            question: 'Why did this fail?',
          })
          await typeInstruction(page, 'Amend this document.')
          await submit(page, "amend this activity's document", '/consult', {
            mode: 'amend',
            question: 'Amend this document.',
          })
          await typeInstruction(page, 'Continue with this note.')
          await submit(page, 'pick it up where it stopped', '/resume', {
            note: 'Continue with this note.',
          })
          expect(
            readFileSync(
              join(data, 'sessions/failed/context_handoff/steering.md'),
              'utf8',
            ),
          ).toContain('Continue with this note.')
          for (const target of ['overwrite', 'branch'] as const) {
            await typeInstruction(page, `Replay using ${target}.`)
            await page
              .getByRole('button', { name: 'steer from here…', exact: true })
              .click()
            await page
              .getByRole('button', { name: 'cancel', exact: true })
              .focus()
            await page.keyboard.press('Enter')
            expect(await page.locator('dialog[open]').count()).toBe(0)
            await page
              .getByRole('button', { name: 'steer from here…', exact: true })
              .click()
            const result = await submit(
              page,
              target === 'overwrite'
                ? 'overwrite these activities rewrite their own documents; what they produced before is not kept'
                : 'branch a new run, seeded from this one up to this activity; both outcomes stay readable',
              '/steer',
              { target, note: `Replay using ${target}.` },
            )
            expect(result.started).toBe(true)
          }
          // Detached workers acknowledge arguments, rather than making a paid
          // model call. Wait for all eight launches before deleting the tree.
          const children = (await waitForChildren(receipt)).map((line) =>
            JSON.parse(line),
          )
          expect(children.some((argv) => argv.includes('--overwrite'))).toBe(
            true,
          )
          expect(children.some((argv) => argv.includes('--branch'))).toBe(true)
        } finally {
          await browser.close()
        }
      } finally {
        await frontend.close()
      }
    } finally {
      api.kill()
      await api.exited
      tracer.close()
      rmSync(root, { recursive: true, force: true })
    }
  },
  60_000,
)
