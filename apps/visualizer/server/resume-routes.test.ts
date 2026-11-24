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
import { createTracer } from '../../../runtime/domains/trace'
import { integrationTestsEnabled } from '../src/lib/testing'
import { NO_RUNTIME, TOKEN_HEADER } from './writes'

const addressOf = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  output = '',
): Promise<string> => {
  const address = output.match(/visualizer api\s+(http:\/\/localhost:\d+)/)?.[1]
  if (address) return address.replace('localhost', '127.0.0.1')
  const next = await reader.read()
  if (next.done) throw new Error(`server exited before listening: ${output}`)
  return addressOf(reader, output + new TextDecoder().decode(next.value))
}

for (const located of [true, false]) {
  test.skipIf(!integrationTestsEnabled)(
    [
      `given a viewer with ${located ? 'an override installation' : 'no installation record'}`,
      'when failed and waiting sessions are resumed through HTTP',
      'it should use the selected installation or report failure while retaining the decision',
    ].join(', '),
    async () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-resume-http-'))
      const data = join(root, 'data')
      const db = join(data, 'crust.db')
      const home = join(root, 'user')
      const receipt = join(root, 'receipts.jsonl')
      const installations = ['A', 'B'].map((name) => join(root, name))
      for (const installation of installations) {
        mkdirSync(join(installation, 'runtime/commands'), { recursive: true })
        writeFileSync(join(installation, 'runtime/cli.ts'), '')
        writeFileSync(
          join(installation, 'runtime/commands/run.ts'),
          `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(receipt)}, JSON.stringify({ script: process.argv[1], args: process.argv.slice(2), cwd: process.cwd(), data: process.env.CRUST_DATA_DIR }) + '\\n')`,
        )
      }
      const tracer = createTracer(db, join(data, 'events.jsonl'))
      for (const id of ['failed', 'waiting']) {
        tracer.sessionStart(id, 'tester', 'test')
        tracer.sessionWorkspace(id, root, 'main', '', root)
        if (id === 'waiting') tracer.sessionWaiting(id)
        else tracer.sessionFinish(id, false)
        const directory = join(data, 'sessions', id)
        mkdirSync(directory, { recursive: true })
        writeFileSync(
          join(directory, 'invocation.json'),
          JSON.stringify({
            argv: [
              'bun',
              join(installations[0] ?? '', 'runtime/commands/run.ts'),
              'request',
            ],
            cwd: root,
          }),
        )
      }
      tracer.close()
      mkdirSync(home)
      if (located) {
        mkdirSync(join(home, '.pi-crust'))
        writeFileSync(
          join(home, '.pi-crust/pi-crust-home'),
          installations[0] ?? '',
        )
      }
      const { CRUST_HOME: _override, ...baseEnv } = process.env
      const child = Bun.spawn(['bun', join(import.meta.dir, 'index.ts')], {
        cwd: root,
        env: {
          ...baseEnv,
          HOME: home,
          CRUST_DB: db,
          CRUST_WORKSPACES: '',
          CRUST_BE_PORT: '0',
          CRUST_TOKEN: 'fixture-token',
          ...(located ? { CRUST_HOME: installations[1] } : {}),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      try {
        const base = await addressOf(child.stdout.getReader())
        const post = (path: string, body: Readonly<Record<string, string>>) =>
          fetch(base + path, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              [TOKEN_HEADER]: 'fixture-token',
            },
            body: JSON.stringify(body),
          })
        // when
        const resumed = await post('/api/sessions/failed/resume', {})
        const decision = await post('/api/sessions/waiting/decision', {
          action: 'approve',
        })
        // then
        expect(resumed.status).toBe(located ? 200 : 503)
        expect(decision.status).toBe(located ? 200 : 503)
        if (located) {
          for (
            let attempt = 0;
            attempt < 100 &&
            (!existsSync(receipt) ||
              readFileSync(receipt, 'utf8').trim().split('\n').length < 2);
            attempt++
          )
            await Bun.sleep(20)
          const lines = readFileSync(receipt, 'utf8').trim().split('\n')
          expect(lines.length).toBe(2)
          expect(
            lines.every((line) => line.includes('/B/runtime/commands/run.ts')),
          ).toBe(true)
          expect(
            lines.every((line) => line.includes(JSON.stringify(data))),
          ).toBe(true)
        } else {
          expect(await resumed.json()).toEqual({ error: NO_RUNTIME })
          const body = (await decision.json()) as { error: string }
          expect(body.error).toStartWith('decision recorded in ')
          expect(body.error).toEndWith(NO_RUNTIME)
          expect(existsSync(receipt)).toBe(false)
        }
        expect(
          existsSync(
            join(data, 'sessions/waiting/context_handoff/decision-answer.md'),
          ),
        ).toBe(true)
      } finally {
        child.kill()
        await child.exited
        rmSync(root, { recursive: true, force: true })
      }
    },
    20_000,
  )
}
