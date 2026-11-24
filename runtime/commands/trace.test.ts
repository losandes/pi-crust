import { Database } from 'bun:sqlite'
import { expect, spyOn, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withShippedPackage } from '../testing/shipped-layer'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { main } from './trace'

for (const mode of [
  'rows',
  'empty',
  'missing',
  'invalid',
  'no-table',
  'usage',
  'no-id',
  'fallback',
] as const) {
  test(
    [
      `given trace ${mode}`,
      `when invoked`,
      `it should print the listing or its diagnostic without writes`,
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-trace-command-'))
      const path = join(root, 'trace.db')
      const config = join(root, 'config.toml')
      writeFileSync(config, `[defaults]\ndata_dir = ${JSON.stringify(root)}\n`)
      const target = join(root, 'crust.db')
      if (mode === 'invalid') writeFileSync(target, 'not a database')
      if (['rows', 'empty', 'no-table'].includes(mode)) {
        const db = new Database(target)
        if (mode === 'no-table') {
          db.exec('create table other(id integer)')
        } else {
          db.exec(
            'create table sessions(run_id text, status text, request text, total_tokens integer, total_cost real, started_at text); create table events(run_id text, type text, name text, started_at text)',
          )
          db.run(
            "insert into sessions values ('one', 'ok', 'request', 4, 0, 'now')",
          )
        }
        db.close()
      }
      const before = existsSync(target) ? readFileSync(target) : undefined
      const cwd = process.cwd()
      const oldDb = process.env.CRUST_DB
      const oldData = process.env.CRUST_DATA_DIR
      process.chdir(root)
      // biome-ignore lint/plugin/no-object-mutation: scope and restore the process inputs consumed by the command
      process.env.CRUST_DB = path
      // biome-ignore lint/plugin/no-object-mutation: scope and restore the process inputs consumed by the command
      process.env.CRUST_DATA_DIR = root
      silenceTerminal()
      let stderr: string[] = []
      const spy = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderr = [...stderr, String(chunk)]
        return true
      })
      try {
        // when
        const args =
          mode === 'usage'
            ? ['unknown']
            : mode === 'no-id'
              ? ['tail']
              : mode === 'empty'
                ? ['tail', 'unknown']
                : ['sessions']
        const status = withShippedPackage(() =>
          main([
            '--config',
            mode === 'fallback' ? '/absent/config.toml' : config,
            ...args,
          ]),
        )
        // then
        expect(status).toBe(
          ['rows', 'empty'].includes(mode)
            ? 0
            : ['usage', 'no-id'].includes(mode)
              ? 2
              : 1,
        )
        expect(terminalOutput()).toBe(
          mode === 'rows' ? 'one|ok|request|4|0.0\n' : '',
        )
        if (['invalid', 'no-table'].includes(mode))
          expect(stderr.join('')).toStartWith(`trace: cannot read ${target}: `)
        if (mode === 'missing')
          expect(stderr.join('')).toBe(
            `trace: no trace database at ${target}\n`,
          )
        if (['usage', 'no-id'].includes(mode))
          expect(stderr.join('')).toBe(
            'usage: bun runtime/commands/trace.ts [--config <path>] <sessions|activity-runs|tail|procs> [<run-id>]\n',
          )
        if (before) expect(readFileSync(target)).toEqual(before)
        else expect(existsSync(target)).toBe(false)
      } finally {
        spy.mockRestore()
        restoreTerminal()
        process.chdir(cwd)
        if (oldDb === undefined) delete process.env.CRUST_DB
        else {
          // biome-ignore lint/plugin/no-object-mutation: scope and restore the process inputs consumed by the command
          process.env.CRUST_DB = oldDb
        }
        if (oldData === undefined) delete process.env.CRUST_DATA_DIR
        else {
          // biome-ignore lint/plugin/no-object-mutation: scope and restore the process inputs consumed by the command
          process.env.CRUST_DATA_DIR = oldData
        }
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
