#!/usr/bin/env bun
/**
 * pi-crust Prune — forget old runs, on disk and in the trace together.
 *
 * Usage:
 *     just crust prune 14d                 # say what WOULD go
 *     just crust prune 14d --yes           # actually delete it
 *
 * Dry by default. Deleting a run is unrecoverable, and a command whose first
 * use is destructive is one somebody will run before reading it.
 *
 * Rows and directories go TOGETHER. Deleting one without the other leaves a
 * trace that references transcripts that are gone, or gigabytes of
 * transcripts no index can find — and the second is how a data directory ends
 * up being deleted wholesale, taking the run somebody needed with it.
 *
 * Exit codes: 0 done (or nothing to do), 2 usage.
 */

import { Database } from 'bun:sqlite'
import { rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { safeParseSettlement } from '../lib/typedefs/src/settlement'
import { loadConfig } from './domains/config'
import {
  parseAge,
  pruneVerdict,
  type TPrunable,
  workspacesIn,
} from './domains/trace'
import { repoRoot, resolveDataPaths } from './domains/workspace'
import { DEFAULT_CONFIG_PATH, DEFAULT_DB, EXIT } from './lib/contracts'
import { configPathFromEnv, dbPathFromEnv, fileExists } from './lib/system'
import { box, paint, writeLine } from './lib/terminal'
export const USAGE =
  'usage: just crust prune <14d|36h> [--yes] [--db <path>] [--tree <path>]\n' +
  'env: CRUST_DB overrides the db path; --db still wins.\n' +
  '--tree restricts pruning to runs whose workspace_root matches exactly; ' +
  'omitted, the whole store is pruned (1.8.2, 1.8.3).'

/** Every table that keys on a run, in an order no foreign key objects to. */
const RUN_TABLES = [
  'events',
  'gate_results',
  'envelopes',
  'agent_sessions',
  'processes',
  'activity_runs',
  'sessions',
] as const

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

const defaultDbPath = (): string => {
  const cfg = safeParseSettlement(() =>
    loadConfig(configPathFromEnv() ?? DEFAULT_CONFIG_PATH),
  )
  return cfg.status === 'ok'
    ? resolveDataPaths(cfg.data, repoRoot()).db
    : DEFAULT_DB
}

export const main = (argv: readonly string[]): number => {
  const age = parseAge(flag(argv, '--older-than'))
  if (age === undefined) {
    writeLine(`--older-than is required, as 14d or 36h\n${USAGE}`)
    return EXIT.USAGE
  }
  const dbPath = flag(argv, '--db') ?? dbPathFromEnv() ?? defaultDbPath()
  if (!fileExists(dbPath)) {
    writeLine(`no trace database at ${dbPath} — nothing to prune`)
    return EXIT.SUCCESS
  }
  const treeFilter = flag(argv, '--tree')

  const db = new Database(dbPath)
  // The sessions directory is a sibling of the database (1.8.3): a pooled
  // store relocated with the config's data_dir is followed with no change
  // here, because this derives it from the db path rather than assuming
  // `.pi-crust/data`.
  const sessionsDir = join(dbPath, '..', 'sessions')
  const everyRun = db
    .query('SELECT run_id, status, started_at, workspace_root FROM sessions')
    .all() as (TPrunable & Readonly<{ workspace_root: string | null }>)[]

  // Say how many working trees this store holds, and name them, before
  // anything is deleted (1.8.1) — a pooled store can hold runs from several
  // trees nobody deleting runs today would expect to find there.
  const trees = workspacesIn(everyRun)
  writeLine(
    paint(
      `${dbPath} holds ${trees.length} working tree(s): ${trees.join(', ') || '(none recorded)'}`,
      'dim',
    ),
  )

  const runs =
    treeFilter === undefined
      ? everyRun
      : everyRun.filter((run) => run.workspace_root === treeFilter)
  const verdict = pruneVerdict(runs, age, Date.now())

  if (verdict.doomed.length === 0) {
    writeLine(`nothing older than ${flag(argv, '--older-than')} to prune`)
    db.close()
    return EXIT.SUCCESS
  }

  if (!argv.includes('--yes')) {
    writeLine(
      box(
        'would prune',
        [
          `${paint(String(verdict.doomed.length), 'bold')} run(s): ${verdict.doomed.join(', ')}`,
          '',
          ...verdict.spared.map((kept) =>
            paint(`keeping ${kept.run_id} — ${kept.because}`, 'dim'),
          ),
          '',
          paint('add --yes to delete them', 'bold'),
        ],
        'yellow',
      ),
    )
    db.close()
    return EXIT.SUCCESS
  }

  for (const runId of verdict.doomed) {
    // The directory first: a row with no transcript is a worse state to be
    // interrupted in than a transcript with no row, because the row is what
    // tells a reader the transcript should exist.
    rmSync(join(sessionsDir, runId), { recursive: true, force: true })
    for (const table of RUN_TABLES) {
      db.run(`DELETE FROM ${table} WHERE run_id = ?`, [runId])
    }
  }
  // Check logs for a working tree this prune just emptied MAY go too (1.8.4):
  // they describe uncommitted state that is gone. Only when a --tree filter
  // named the tree being pruned — an unfiltered prune has no single tree to
  // single out, and deletes nothing here that 1.8.3 did not already cover.
  if (treeFilter !== undefined) {
    const checksDir = join(dbPath, '..', 'checks', basename(treeFilter))
    rmSync(checksDir, { recursive: true, force: true })
  }
  // Reclaim the pages, or the file keeps the space a pruned run used.
  db.run('VACUUM')
  db.close()

  writeLine(
    box(
      'pruned',
      [
        `${paint(String(verdict.doomed.length), 'bold')} run(s) removed from ${dbPath}`,
        paint('and their session directories', 'dim'),
      ],
      'green',
    ),
  )
  return EXIT.SUCCESS
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
