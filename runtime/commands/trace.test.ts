import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadConfig } from '../domains/config'
import { SKIP_INTEGRATION } from '../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { main } from './trace'

const MODES = [
  'rows',
  'empty',
  'missing',
  'invalid',
  'no-table',
  'usage',
  'no-id',
] as const

type TMode = (typeof MODES)[number] | 'fallback'

const fixture = (mode: TMode) => {
  const root = mkdtempSync(join(tmpdir(), 'crust-trace-command-'))
  const config = join(root, 'config.toml')
  if (mode !== 'fallback')
    writeFileSync(
      config,
      `[defaults]\ndata_dir = ${JSON.stringify(root)}\n` +
        '[planners.operator]\nwrites = []\n' +
        '[planners.triage]\nwrites = []\n' +
        '[terminal.gh-pull-request]\nwrites = []\n',
    )
  const target =
    mode === 'fallback'
      ? join(root, '.pi-crust/data/crust.db')
      : join(root, 'crust.db')
  if (mode === 'invalid') writeFileSync(target, 'not a database')
  if (['rows', 'empty', 'no-table', 'fallback'].includes(mode)) {
    mkdirSync(dirname(target), { recursive: true })
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
  const args =
    mode === 'usage'
      ? ['unknown']
      : mode === 'no-id'
        ? ['tail']
        : mode === 'empty'
          ? ['tail', 'unknown']
          : ['sessions']
  return {
    root,
    config,
    target,
    before,
    argv: ['--config', config, ...args],
    status: ['rows', 'empty', 'fallback'].includes(mode)
      ? 0
      : ['usage', 'no-id'].includes(mode)
        ? 2
        : 1,
    output: ['rows', 'fallback'].includes(mode) ? 'one|ok|request|4|0.0\n' : '',
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true }),
  }
}

for (const mode of MODES) {
  test(
    [
      `given trace ${mode} with an explicit data directory`,
      'when invoked in process',
      'it should return the status and output without changing the database',
    ].join(', '),
    () => {
      // given
      using given = fixture(mode)
      expect(process.env.CRUST_DATA_DIR?.trim() ?? '').toBe('')
      expect(loadConfig(given.config).defaults.data_dir).toBe(given.root)
      silenceTerminal()
      try {
        // when
        const status = main(given.argv)
        // then
        expect(status).toBe(given.status)
        expect(terminalOutput()).toBe(given.output)
        if (given.before)
          expect(readFileSync(given.target)).toEqual(given.before)
        else expect(existsSync(given.target)).toBe(false)
      } finally {
        restoreTerminal()
      }
    },
  )
}

for (const mode of [...MODES, 'fallback'] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given trace ${mode} in an isolated process environment`,
      'when the command starts from a scratch directory',
      'it should preserve diagnostics bytes and exit status while ignoring CRUST_DB',
    ].join(', '),
    () => {
      // given
      using given = fixture(mode)
      const home = join(given.root, 'home')
      const machine = join(given.root, 'machine')
      mkdirSync(home)
      mkdirSync(machine)
      const alternate = join(given.root, 'alternate.db')
      const db = new Database(alternate)
      db.exec(
        'create table sessions(run_id text, status text, request text, total_tokens integer, total_cost real, started_at text)',
      )
      db.run(
        "insert into sessions values ('wrong', 'ok', 'wrong database', 0, 0, 'now')",
      )
      db.close()
      // when
      const result = spawnSync(
        'bun',
        [join(import.meta.dir, 'trace.ts'), ...given.argv],
        {
          cwd: given.root,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            CRUST_MACHINE_CONFIG: machine,
            PI_PATH: join(given.root, 'no-pi'),
            CRUST_DB: alternate,
          },
          encoding: 'utf8',
        },
      )
      // then
      expect(result.status).toBe(given.status)
      expect(result.stdout).toBe(given.output)
      if (['invalid', 'no-table'].includes(mode)) {
        expect(result.stderr).toStartWith(
          `trace: cannot read ${given.target}: `,
        )
        expect(result.stderr.trim().split('\n')).toHaveLength(1)
      } else if (mode === 'missing') {
        expect(result.stderr).toBe(
          `trace: no trace database at ${given.target}\n`,
        )
      } else if (['usage', 'no-id'].includes(mode)) {
        expect(result.stderr).toBe(
          'usage: bun runtime/commands/trace.ts [--config <path>] <sessions|activity-runs|tail|procs> [<run-id>]\n',
        )
      } else {
        expect(result.stderr).toBe('')
      }
      if (given.before) expect(readFileSync(given.target)).toEqual(given.before)
      else expect(existsSync(given.target)).toBe(false)
    },
  )
}
