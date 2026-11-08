import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from './domains/trace'
import { DEFAULT_DB, EXIT } from './lib/contracts'
import { main, USAGE } from './prune'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from './testing/terminal-capture'

/*
 * prune.ts's own pure decisions (`parseAge`, `pruneVerdict`, `workspacesIn`)
 * are covered in modules/use-cases/prune.test.ts. Nothing there proved the
 * entry point itself wires those decisions to a real database, a real
 * session directory, and the exit codes a caller branches on.
 */

beforeEach(silenceTerminal)
afterEach(restoreTerminal)

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-prune-'))

const DAY_MS = 86_400_000

/** A session row, backdated by `ageDays`, with an optional workspace. */
const aSession = (
  db: Database,
  runId: string,
  ageDays: number,
  status: string,
  workspaceRoot?: string,
): void => {
  const startedAt = new Date(Date.now() - ageDays * DAY_MS).toISOString()
  db.run(
    'INSERT INTO sessions (run_id, status, started_at, workspace_root) VALUES (?,?,?,?)',
    [runId, status, startedAt, workspaceRoot ?? null],
  )
}

test(
  [
    'given prune::main',
    'when --older-than is missing',
    'it should print the usage and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    // when
    const actual = main([])

    // then
    expect(actual).toEqual(EXIT.USAGE)
    expect(terminalOutput()).toContain(USAGE)
  },
)

test(
  [
    'given prune::main',
    'when no database exists at the given path',
    'it should report there is nothing to prune and return EXIT.SUCCESS',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')

    // when
    const actual = main(['--older-than', '14d', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('nothing to prune')
  },
)

test(
  [
    'given prune::main',
    'when every run is younger than the given age',
    'it should report nothing is old enough and keep the session directory',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()
    const db = new Database(dbPath)
    aSession(db, 'aaaa1111', 1, 'success')
    db.close()
    const sessionDir = join(dir, 'sessions', 'aaaa1111')
    mkdirSync(sessionDir, { recursive: true })

    // when
    const actual = main(['--older-than', '14d', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('nothing older than 14d')
    expect(existsSync(sessionDir)).toBe(true)
  },
)

test(
  [
    'given prune::main',
    'when a run is old enough but --yes is absent',
    'it should print a dry preview and delete nothing',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()
    const db = new Database(dbPath)
    aSession(db, 'bbbb2222', 30, 'success')
    // still waiting, however old: kept, and named in the preview too
    aSession(db, 'bbbb9999', 30, 'waiting')
    db.close()
    const sessionDir = join(dir, 'sessions', 'bbbb2222')
    mkdirSync(sessionDir, { recursive: true })

    // when
    const actual = main(['--older-than', '14d', '--db', dbPath])

    // then
    expect(actual).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('would prune')
    expect(terminalOutput()).toContain('bbbb2222')
    expect(terminalOutput()).toContain('keeping bbbb9999')
    expect(existsSync(sessionDir)).toBe(true)
    const remaining = new Database(dbPath)
      .query('SELECT run_id FROM sessions WHERE run_id = ?')
      .get('bbbb2222')
    expect(remaining).not.toBeNull()
  },
)

test(
  [
    'given prune::main',
    'when a run is old enough and --yes is given',
    'it should delete its session directory and its rows, and report it pruned',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()
    const db = new Database(dbPath)
    aSession(db, 'cccc3333', 30, 'success')
    // a run that is still running must never be pruned, whatever its age
    aSession(db, 'dddd4444', 30, 'running')
    db.close()
    const doomedDir = join(dir, 'sessions', 'cccc3333')
    const keptDir = join(dir, 'sessions', 'dddd4444')
    mkdirSync(doomedDir, { recursive: true })
    mkdirSync(keptDir, { recursive: true })

    // when
    const actual = main(['--older-than', '14d', '--db', dbPath, '--yes'])

    // then
    expect(actual).toEqual(EXIT.SUCCESS)
    expect(terminalOutput()).toContain('pruned')
    expect(existsSync(doomedDir)).toBe(false)
    expect(existsSync(keptDir)).toBe(true)
    const verify = new Database(dbPath)
    expect(
      verify
        .query('SELECT run_id FROM sessions WHERE run_id = ?')
        .get('cccc3333'),
    ).toBeNull()
    expect(
      verify
        .query('SELECT run_id FROM sessions WHERE run_id = ?')
        .get('dddd4444'),
    ).not.toBeNull()
    verify.close()
  },
)

test(
  [
    'given prune::main',
    'when --tree narrows pruning to one working tree',
    'it should prune only that tree\u2019s old runs and remove its checks directory',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.close()
    const db = new Database(dbPath)
    aSession(db, 'eeee5555', 30, 'success', '/repo/a')
    aSession(db, 'ffff6666', 30, 'success', '/repo/b')
    db.close()
    mkdirSync(join(dir, 'sessions', 'eeee5555'), { recursive: true })
    mkdirSync(join(dir, 'sessions', 'ffff6666'), { recursive: true })
    const checksDir = join(dir, 'checks', 'a')
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(join(checksDir, 'last.log'), 'ok\n')

    // when
    const actual = main([
      '--older-than',
      '14d',
      '--db',
      dbPath,
      '--tree',
      '/repo/a',
      '--yes',
    ])

    // then
    expect(actual).toEqual(EXIT.SUCCESS)
    expect(existsSync(join(dir, 'sessions', 'eeee5555'))).toBe(false)
    expect(existsSync(join(dir, 'sessions', 'ffff6666'))).toBe(true)
    expect(existsSync(checksDir)).toBe(false)
    const verify = new Database(dbPath)
    expect(
      verify
        .query('SELECT run_id FROM sessions WHERE run_id = ?')
        .get('eeee5555'),
    ).toBeNull()
    expect(
      verify
        .query('SELECT run_id FROM sessions WHERE run_id = ?')
        .get('ffff6666'),
    ).not.toBeNull()
    verify.close()
  },
)

test(
  [
    'given prune::main',
    'when no --db flag or CRUST_DB is given, but the configuration loads',
    'it should resolve the db path from the configuration and find nothing to prune',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const dbPath = join(dataDir, 'crust.db')
    const configPath = join(dataDir, 'crust.config.yaml')
    writeFileSync(
      configPath,
      `defaults:\n  data_dir: ${dataDir}\nobservability:\n  db: ${dbPath}\nagents: []\n`,
    )
    const originalDb = process.env.CRUST_DB
    const originalConfig = process.env.CRUST_CONFIG
    const originalMachineConfig = process.env.CRUST_MACHINE_CONFIG
    delete process.env.CRUST_DB
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API defaultDbPath reads through configPathFromEnv
    process.env.CRUST_CONFIG = configPath
    // A machine-level crust.config.yaml must not be merged in — it would
    // override this test's own data_dir with whatever this developer
    // machine has set.
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API loadConfig reads through machineConfigPath
    process.env.CRUST_MACHINE_CONFIG = join(
      dataDir,
      'no-such-machine-config.yaml',
    )

    try {
      // when
      const actual = main(['--older-than', '14d'])

      // then
      expect(actual).toEqual(EXIT.SUCCESS)
      expect(terminalOutput()).toContain('nothing to prune')
    } finally {
      if (originalDb === undefined) {
        delete process.env.CRUST_DB
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_DB = originalDb
      }
      if (originalConfig === undefined) {
        delete process.env.CRUST_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_CONFIG = originalConfig
      }
      if (originalMachineConfig === undefined) {
        delete process.env.CRUST_MACHINE_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_MACHINE_CONFIG = originalMachineConfig
      }
    }
  },
)

/*
 * DEFAULT_DB is RELATIVE, so the fallback resolves against the process's
 * working directory. Left at the repository root, this test prunes the
 * developer's own trace database and asserts against whatever that machine
 * happens to hold — it passed on an empty store and failed the moment a real
 * run was in it. The working directory is the thing under test here, so the
 * test moves to an empty one and the assertion names the path prune chose.
 */
test(
  [
    'given prune::main',
    'when no --db flag, no CRUST_DB, and the configuration cannot be read',
    'it should still fall back to the built-in default db path and find nothing to prune',
  ].join(', '),
  () => {
    // given
    const originalDb = process.env.CRUST_DB
    const originalConfig = process.env.CRUST_CONFIG
    const originalCwd = process.cwd()
    delete process.env.CRUST_DB
    // biome-ignore lint/plugin/no-object-mutation: process.env is the external API defaultDbPath reads through configPathFromEnv
    process.env.CRUST_CONFIG = '/no/such/crust.config.yaml'
    process.chdir(scratch())

    try {
      // when
      const actual = main(['--older-than', '14d'])

      // then
      expect(actual).toEqual(EXIT.SUCCESS)
      expect(terminalOutput()).toContain(
        `no trace database at ${DEFAULT_DB} — nothing to prune`,
      )
    } finally {
      process.chdir(originalCwd)
      if (originalDb === undefined) {
        delete process.env.CRUST_DB
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_DB = originalDb
      }
      if (originalConfig === undefined) {
        delete process.env.CRUST_CONFIG
      } else {
        // biome-ignore lint/plugin/no-object-mutation: restoring the environment this test borrowed
        process.env.CRUST_CONFIG = originalConfig
      }
    }
  },
)
