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
import { join } from 'node:path'
import { dbPathFromEnv } from './modules/data/env-overrides'
import { box, paint, writeLine } from './modules/data/terminal'
import { fileExists } from './modules/data/files'
import { DEFAULT_DB } from './modules/typedefs/config'
import { EXIT } from './modules/typedefs/run-state'
import { parseAge, pruneVerdict, type TPrunable } from './modules/use-cases/prune'

export const USAGE =
  'usage: just crust prune <14d|36h> [--yes] [--db <path>]\n' +
  'env: CRUST_DB overrides the db path; --db still wins.'

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

export const main = (argv: readonly string[]): number => {
  const age = parseAge(flag(argv, '--older-than'))
  if (age === undefined) {
    writeLine(`--older-than is required, as 14d or 36h\n${USAGE}`)
    return EXIT.USAGE
  }
  const dbPath = flag(argv, '--db') ?? dbPathFromEnv() ?? DEFAULT_DB
  if (!fileExists(dbPath)) {
    writeLine(`no trace database at ${dbPath} — nothing to prune`)
    return EXIT.SUCCESS
  }

  const db = new Database(dbPath)
  const runs = db
    .query('SELECT run_id, status, started_at FROM sessions')
    .all() as TPrunable[]
  const verdict = pruneVerdict(runs, age, Date.now())
  const sessionsDir = join(dbPath, '..', 'sessions')

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
          ...verdict.spared.map(
            (kept) => paint(`keeping ${kept.run_id} — ${kept.because}`, 'dim'),
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
