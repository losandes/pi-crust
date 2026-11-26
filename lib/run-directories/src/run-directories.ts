import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { openDatabase, type TDatabase } from '../../sqlite'
import {
  fail,
  safeParseSettlement,
  settledOr,
  succeed,
  type TSettlement,
} from '../../typedefs'

export type TRunStore = Readonly<{ dbPath: string; sessionsDir: string }>
export const RUN_DIRECTORIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_directories (
  run_id TEXT PRIMARY KEY,
  repository_dir TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_directories (
  path TEXT PRIMARY KEY
);
`
export const sessionsDirIn = (dataDir: string): string =>
  join(dataDir, 'sessions')
const tableExists = (db: TDatabase, name: string): boolean =>
  db
    .query(
      `SELECT
  m.name
FROM sqlite_master AS m
WHERE m.name = ?
  AND m.type = ?`,
    )
    .get(name, 'table') !== undefined
const rowFor = (db: TDatabase, runId: string): unknown =>
  db
    .query(
      `SELECT
  r.repository_dir
FROM run_directories AS r
WHERE r.run_id = ?`,
    )
    .get(runId)
const pathFromRow = (row: unknown): readonly string[] | undefined => {
  const parsed = z.object({ repository_dir: z.string() }).safeParse(row)
  if (!parsed.success) return undefined
  const parts = parsed.data.repository_dir.split('/')
  return parts.every(
    (part) =>
      part !== '' && part !== '.' && part !== '..' && !/[\\\0]/.test(part),
  )
    ? parts
    : undefined
}
const withReader = <T>(
  store: TRunStore,
  fallback: T,
  read: (db: TDatabase) => T,
): T => {
  if (!existsSync(store.dbPath)) return fallback
  return settledOr(
    safeParseSettlement(() => {
      const db = openDatabase(store.dbPath, { readonly: true })
      try {
        return tableExists(db, 'run_directories') ? read(db) : fallback
      } finally {
        db.close()
      }
    }),
    fallback,
  )
}
export const registeredRepositoryPath =
  (store: TRunStore) =>
  (runId: string): readonly string[] | undefined =>
    withReader<readonly string[] | undefined>(store, undefined, (db) =>
      pathFromRow(rowFor(db, runId)),
    )
export const resolveRunDirectory =
  (store: TRunStore) =>
  (runId: string): string =>
    join(
      store.sessionsDir,
      ...(registeredRepositoryPath(store)(runId) ?? []),
      runId,
    )
export const runIdTaken =
  (store: TRunStore) =>
  (candidate: string): boolean =>
    existsSync(join(store.sessionsDir, candidate)) ||
    withReader(store, false, (db) => rowFor(db, candidate) !== undefined)
export const forgetRunDirectory =
  (store: TRunStore) =>
  (runId: string): void => {
    if (!existsSync(store.dbPath)) return
    const db = openDatabase(store.dbPath)
    try {
      if (tableExists(db, 'run_directories'))
        db.run(
          `DELETE FROM run_directories
WHERE run_id = ?`,
          [runId],
        )
    } finally {
      db.close()
    }
  }
const grouping = (db: TDatabase, path: string): boolean =>
  db
    .query(
      `SELECT
  r.path
FROM repository_directories AS r
WHERE r.path = ?`,
    )
    .get(path) !== undefined
const directoryExists = (path: string): boolean =>
  settledOr(
    safeParseSettlement(() => statSync(path).isDirectory()),
    false,
  )
const answerRow = (
  store: TRunStore,
  runId: string,
  row: unknown,
): TSettlement<string> => {
  const path = pathFromRow(row)
  return path === undefined
    ? fail(
        new Error(
          `run '${runId}' has an invalid stored directory ${JSON.stringify(row)} beneath ${store.sessionsDir}`,
        ),
      )
    : succeed(join(store.sessionsDir, ...path, runId))
}
const decideClaim = (
  db: TDatabase,
  store: TRunStore,
  runId: string,
  repositoryPath: readonly string[],
): TSettlement<string> => {
  const row = rowFor(db, runId)
  if (row !== undefined) return answerRow(store, runId, row)
  const flat = join(store.sessionsDir, runId)
  if (directoryExists(flat))
    return grouping(db, runId)
      ? fail(
          new Error(`run '${runId}' conflicts with grouping directory ${flat}`),
        )
      : succeed(flat)
  const target = join(store.sessionsDir, ...repositoryPath, runId)
  const valid = pathFromRow({ repository_dir: repositoryPath.join('/') })
  if (
    valid === undefined ||
    valid.length !== repositoryPath.length ||
    repositoryPath.length < 2
  )
    return fail(new Error(`run '${runId}' has an invalid directory ${target}`))
  const prefixes = repositoryPath.map((_, index) =>
    repositoryPath.slice(0, index + 1),
  )
  const conflict = prefixes.find((prefix) => {
    const dir = join(store.sessionsDir, ...prefix)
    const id = basename(dir)
    const registered = rowFor(db, id)
    if (registered !== undefined) {
      const path = pathFromRow(registered)
      return path !== undefined && join(store.sessionsDir, ...path, id) === dir
    }
    return (
      prefix.length === 1 &&
      !grouping(db, id) &&
      (existsSync(dir) ||
        (tableExists(db, 'sessions') &&
          db
            .query(
              `SELECT
  s.run_id
FROM sessions AS s
WHERE s.run_id = ?`,
            )
            .get(id) !== undefined))
    )
  })
  if (conflict !== undefined) {
    const dir = join(store.sessionsDir, ...conflict)
    return fail(
      new Error(
        `run '${runId}' conflicts with ${dir}, which belongs to run '${basename(dir)}'; pruning or renaming is the developer's to do`,
      ),
    )
  }
  if (grouping(db, [...repositoryPath, runId].join('/')) || existsSync(target))
    return fail(new Error(`run '${runId}' conflicts with directory ${target}`))
  for (const prefix of prefixes)
    db.run(
      `INSERT INTO repository_directories (
  path
)
VALUES (
  ?
)
ON CONFLICT(path) DO NOTHING`,
      [prefix.join('/')],
    )
  db.run(
    `INSERT INTO run_directories (
  run_id,
  repository_dir
)
VALUES (
  ?,
  ?
)
ON CONFLICT(run_id) DO NOTHING`,
    [runId, repositoryPath.join('/')],
  )
  return answerRow(store, runId, rowFor(db, runId))
}
export const claimRunDirectory =
  (store: TRunStore) =>
  (runId: string, repositoryPath: readonly string[]): TSettlement<string> => {
    const result = safeParseSettlement(() => {
      mkdirSync(dirname(store.dbPath), { recursive: true })
      const db = openDatabase(store.dbPath)
      try {
        db.exec('PRAGMA busy_timeout=5000')
        db.exec(RUN_DIRECTORIES_SCHEMA)
        db.exec('BEGIN IMMEDIATE')
        const claim = safeParseSettlement(() =>
          decideClaim(db, store, runId, repositoryPath),
        )
        const answer = claim.status === 'ok' ? claim.data : claim
        if (answer.status === 'error') {
          db.exec('ROLLBACK')
          return answer
        }
        const committed = safeParseSettlement(() => db.exec('COMMIT'))
        if (committed.status === 'error') {
          db.exec('ROLLBACK')
          return committed
        }
        return answer
      } finally {
        db.close()
      }
    })
    const answer = result.status === 'ok' ? result.data : result
    return answer.status === 'ok'
      ? answer
      : fail(
          new Error(
            `run '${runId}' could not claim ${join(store.sessionsDir, ...repositoryPath, runId)}: ${answer.error.message}`,
          ),
        )
  }
